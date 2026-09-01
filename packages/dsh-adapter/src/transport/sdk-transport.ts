import type { AiField, ApprovalInput, CreateSessionInput, HarnessErrorCode, HarnessEvent, HarnessSession, RunInput } from '@robbot/core';
import { HarnessError } from '@robbot/core';
import { createHash, randomUUID } from 'node:crypto';

import { mapSdkNotificationToHarnessEvents } from '../mapper/sdk-event-mapper.js';
import type { DshRuntimeManager } from '../runtime/dsh-runtime-manager.js';
import { readRobbotEnvValueFromDshRoot } from './process/dsh-process.js';
import type { StdioChannel } from './process/stdio-channel.js';
import type { HarnessTransport } from './transport.js';

type JsonRpcId = number | string;

const SDK_PROMPT_RPC_TIMEOUT_MS = 30_000;
const SDK_INITIALIZE_RPC_TIMEOUT_MS = 60_000;
const SDK_PROTOCOL_IDLE_TIMEOUT_MS = 120_000;

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: { message?: string; code?: number | string };
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

interface SdkSession {
  id: string;
  workspacePath: string;
  processKey: string;
  channel: StdioChannel;
  route: SdkRoute;
}

interface SdkRunState {
  runId: string;
  sessionId: string;
  promptMessageId?: string;
  promptAccepted: boolean;
  pendingNotifications: Array<{ method: string; params: unknown }>;
  sawTurnEnd: boolean;
  turnEndReason?: SdkTurnEndReason;
  idle: boolean;
}

interface SdkTurnEndReason {
  kind?: string;
  error?: {
    message?: string;
    code?: string;
  };
}

export class SdkTransport implements HarnessTransport {
  readonly mode = 'sdk' as const;
  private nextId = 1;
  private readonly sessions = new Map<string, SdkSession>();
  private readonly initializedByProcessKey = new Map<string, Promise<StdioChannel>>();
  private readonly channelByProcessKey = new Map<string, StdioChannel>();
  private readonly pendingByProcessKey = new Map<string, Map<JsonRpcId, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout?: ReturnType<typeof setTimeout>;
  }>>();
  private readonly eventQueues = new Map<string, AsyncEventQueue<HarnessEvent>>();
  private readonly runStates = new Map<string, SdkRunState>();
  private readonly runLocksByProcessKey = new Map<string, Promise<void>>();

  constructor(private readonly runtimeManager: DshRuntimeManager) {}

  capabilities() {
    return {
      streaming: 'runtime-events' as const,
      toolEvents: true,
      cancelCurrentRun: false,
      terminateRuntime: true,
      approval: false,
      sessionResume: false,
    };
  }

  async createSession(input: CreateSessionInput): Promise<HarnessSession> {
    const id = randomUUID();
    const runtime = this.runtimeManager.resolveRuntime();
    const route = resolveSdkRoute(input.metadata, runtime.root, runtime.config.provider, runtime.config.model);
    const processKey = processKeyForRoute(input.workspacePath, route);
    console.info('[robbot:dsh-sdk] create session', {
      sessionId: id,
      processKey: summarizeProcessKey(processKey),
      workspacePath: input.workspacePath,
      provider: route.provider,
      model: route.model,
      warmed: this.initializedByProcessKey.has(processKey),
    });
    const channel = await this.ensureInitialized(processKey, input.workspacePath, route);
    this.sessions.set(id, {
      id,
      workspacePath: input.workspacePath,
      processKey,
      channel,
      route,
    });

    return {
      id,
      workspacePath: input.workspacePath,
      createdAt: new Date().toISOString(),
      metadata: input.metadata,
    };
  }

  async warmup(input: CreateSessionInput): Promise<void> {
    const runtime = this.runtimeManager.resolveRuntime();
    const route = resolveSdkRoute(input.metadata, runtime.root, runtime.config.provider, runtime.config.model);
    const processKey = processKeyForRoute(input.workspacePath, route);
    console.info('[robbot:dsh-sdk] warmup requested', {
      processKey: summarizeProcessKey(processKey),
      workspacePath: input.workspacePath,
      provider: route.provider,
      model: route.model,
      hasExistingInitialization: this.initializedByProcessKey.has(processKey),
      hasChannel: this.channelByProcessKey.has(processKey),
    });
    const startedAt = Date.now();
    await this.ensureInitialized(processKey, input.workspacePath, route);
    console.info('[robbot:dsh-sdk] warmup completed', {
      processKey: summarizeProcessKey(processKey),
      elapsedMs: Date.now() - startedAt,
    });
  }

  async *run(sessionId: string, input: RunInput): AsyncIterable<HarnessEvent> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new HarnessError(`Unknown SDK session: ${sessionId}`, 'protocol_error');
    }

    const runId = randomUUID();
    const queue = this.getQueue(sessionId);
    const state: SdkRunState = {
      runId,
      sessionId,
      promptAccepted: false,
      pendingNotifications: [],
      sawTurnEnd: false,
      idle: false,
    };

    this.runStates.set(sessionId, state);
    yield { type: 'run.started', runId, sessionId };

    let releaseRunLock: (() => void) | undefined;
    try {
      const runLock = this.reserveProcessRunLock(session.processKey);
      console.info('[robbot:dsh-sdk] waiting for process run lock', {
        sessionId,
        runId,
        processKey: summarizeProcessKey(session.processKey),
      });
      while (!releaseRunLock) {
        const lockResult = await Promise.race([
          runLock.then((release) => ({ release })),
          delay(5_000).then(() => undefined),
        ]);
        if (lockResult) {
          releaseRunLock = lockResult.release;
        } else {
          console.info('[robbot:dsh-sdk] still waiting for process run lock', {
            sessionId,
            runId,
            processKey: summarizeProcessKey(session.processKey),
          });
          yield { type: 'runtime.activity' };
        }
      }
      console.info('[robbot:dsh-sdk] acquired process run lock', {
        sessionId,
        runId,
        processKey: summarizeProcessKey(session.processKey),
      });

      if (this.sessions.get(sessionId) !== session) {
        throw new HarnessError('DSH SDK runtime was terminated.', 'runtime_terminated');
      }

      const receipt = await this.sendPromptWithColdStartRetry(session, input.prompt);
      state.promptMessageId = receipt.messageId;
      for (const notification of state.pendingNotifications.splice(0)) {
        this.handleNotification(notification.method, notification.params);
      }

      while (!state.promptAccepted || !state.sawTurnEnd || !state.idle) {
        const event = await queue.shift(SDK_PROTOCOL_IDLE_TIMEOUT_MS);
        if (event) {
          yield event;
        }
      }

      if (!state.turnEndReason?.kind || state.turnEndReason.kind === 'completed') {
        yield { type: 'run.completed', runId };
      } else {
        const error = errorFromTurnEndReason(state.turnEndReason);
        yield {
          type: 'run.failed',
          runId,
          error,
        };
      }
    } catch (error) {
      yield {
        type: 'run.failed',
        runId,
        error: {
          code: error instanceof HarnessError ? error.code : 'protocol_error',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    } finally {
      releaseRunLock?.();
      if (releaseRunLock) {
        console.info('[robbot:dsh-sdk] released process run lock', {
          sessionId,
          runId,
          processKey: summarizeProcessKey(session.processKey),
        });
      }
      this.runStates.delete(sessionId);
    }
  }

  async cancel(_sessionId: string): Promise<void> {
    throw new HarnessError('DSH SDK transport does not support per-session cancel yet.', 'unsupported_capability');
  }

  async terminate(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    await this.terminateProcess(session.processKey, {
      code: 'runtime_terminated',
      message: 'DSH SDK runtime was terminated.',
    });
  }

  async approve(_sessionId: string, _input: ApprovalInput): Promise<void> {
    throw new HarnessError('DSH SDK transport does not support approval responses yet.', 'unsupported_capability');
  }

  async terminateAll(): Promise<void> {
    await this.runtimeManager.stopAll();
    for (const [processKey, pending] of this.pendingByProcessKey.entries()) {
      for (const [id, request] of pending.entries()) {
        if (request.timeout) {
          clearTimeout(request.timeout);
        }
        request.reject(new HarnessError('DSH SDK runtime was terminated.', 'runtime_terminated'));
        pending.delete(id);
      }
      this.pendingByProcessKey.delete(processKey);
    }
    for (const queue of this.eventQueues.values()) {
      queue.push({
        type: 'run.interrupted',
        error: { code: 'runtime_terminated', message: 'DSH SDK runtime was terminated.' },
      });
    }
    this.sessions.clear();
    this.initializedByProcessKey.clear();
    this.channelByProcessKey.clear();
    this.pendingByProcessKey.clear();
    this.runStates.clear();
    this.runLocksByProcessKey.clear();
  }

  private async ensureInitialized(processKey: string, workspacePath: string, route: SdkRoute): Promise<StdioChannel> {
    const existing = this.initializedByProcessKey.get(processKey);
    if (existing) {
      console.info('[robbot:dsh-sdk] reusing initialization', {
        processKey: summarizeProcessKey(processKey),
        hasChannel: this.channelByProcessKey.has(processKey),
      });
      return existing;
    }

    console.info('[robbot:dsh-sdk] initializing process', {
      processKey: summarizeProcessKey(processKey),
      workspacePath,
      provider: route.provider,
      model: route.model,
    });
    const initialized = this.connectAndInitialize(processKey, workspacePath, route);
    const guarded = initialized.catch((error) => {
      this.initializedByProcessKey.delete(processKey);
      console.warn('[robbot:dsh-sdk] initialization failed', {
        processKey: summarizeProcessKey(processKey),
        message: error instanceof Error ? error.message : String(error),
        code: error instanceof HarnessError ? error.code : undefined,
      });
      throw error;
    });
    this.initializedByProcessKey.set(processKey, guarded);
    return guarded;
  }

  private async connectAndInitialize(processKey: string, workspacePath: string, route: SdkRoute): Promise<StdioChannel> {
    const startedAt = Date.now();
    console.info('[robbot:dsh-sdk] starting process for initialize', {
      processKey: summarizeProcessKey(processKey),
      workspacePath,
      provider: route.provider,
      model: route.model,
    });
    const processHandle = await this.runtimeManager.start(processKey, 'sdk', {
      DSH_CWD: workspacePath,
      DSH_MODEL: route.model,
      DSH_SESSION_ROOT: `${workspacePath}/.robbot/dsh-sessions`,
      ...providerEnvOverrides(route),
    });
    const channel = processHandle.getChannel();
    this.channelByProcessKey.set(processKey, channel);
    this.pendingByProcessKey.set(processKey, new Map());
    channel.onMessage((message) => this.handleMessage(processKey, message));
    console.info('[robbot:dsh-sdk] sending initialize', {
      processKey: summarizeProcessKey(processKey),
      elapsedMs: Date.now() - startedAt,
    });
    await this.request(processKey, 'initialize', {
      cwd: workspacePath,
      provider: route.provider,
      model: route.model,
    }, { timeoutMs: SDK_INITIALIZE_RPC_TIMEOUT_MS, timeoutCode: 'sdk_request_timeout' });
    console.info('[robbot:dsh-sdk] initialized process', {
      processKey: summarizeProcessKey(processKey),
      elapsedMs: Date.now() - startedAt,
    });
    return channel;
  }

  private async sendPromptWithColdStartRetry(session: SdkSession, prompt: string): Promise<{ messageId: string }> {
    try {
      return await this.sendPrompt(session, prompt);
    } catch (error) {
      if (!(error instanceof HarnessError) || error.code !== 'sdk_prompt_timeout') {
        throw error;
      }

      console.warn('[robbot:dsh-sdk] prompt timed out before receipt; restarting runtime and retrying once', {
        sessionId: session.id,
        workspacePath: session.workspacePath,
        processKey: summarizeProcessKey(session.processKey),
      });
      await this.restartSessionProcess(session);
      return this.sendPrompt(session, prompt);
    }
  }

  private async sendPrompt(session: SdkSession, prompt: string): Promise<{ messageId: string }> {
    return this.request<{ messageId: string }>(session.processKey, 'session/prompt', {
      sessionId: session.id,
      contentBlocks: [{ type: 'text', text: prompt }],
    }, { timeoutMs: SDK_PROMPT_RPC_TIMEOUT_MS, timeoutCode: 'sdk_prompt_timeout' });
  }

  private async restartSessionProcess(session: SdkSession): Promise<void> {
    console.warn('[robbot:dsh-sdk] restarting session process', {
      sessionId: session.id,
      processKey: summarizeProcessKey(session.processKey),
    });
    this.rejectPendingForProcess(session.processKey, {
      code: 'runtime_terminated',
      message: 'DSH SDK runtime was restarted after prompt timeout.',
    });
    await this.runtimeManager.stop(session.processKey, 'sdk');
    this.initializedByProcessKey.delete(session.processKey);
    this.channelByProcessKey.delete(session.processKey);
    this.pendingByProcessKey.delete(session.processKey);
    session.channel = await this.ensureInitialized(session.processKey, session.workspacePath, session.route);
    console.warn('[robbot:dsh-sdk] restarted session process', {
      sessionId: session.id,
      processKey: summarizeProcessKey(session.processKey),
    });
  }

  private reserveProcessRunLock(processKey: string): Promise<() => void> {
    const previous = this.runLocksByProcessKey.get(processKey) ?? Promise.resolve();
    let releaseCurrent: () => void = () => {};
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const lock = previous.catch(() => undefined).then(() => current);
    this.runLocksByProcessKey.set(processKey, lock);

    return previous.catch(() => undefined).then(() => {
      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        releaseCurrent();
        if (this.runLocksByProcessKey.get(processKey) === lock) {
          this.runLocksByProcessKey.delete(processKey);
        }
      };
    });
  }

  private request<T = unknown>(
    processKey: string,
    method: string,
    params?: unknown,
    options: { timeoutMs?: number; timeoutCode?: HarnessErrorCode } = {},
  ): Promise<T> {
    const session = [...this.sessions.values()].find((item) => item.processKey === processKey);
    const channel = session?.channel ?? this.channelByProcessKey.get(processKey);
    const pending = this.pendingByProcessKey.get(processKey);
    if (!pending) {
      throw new HarnessError('DSH SDK transport is not connected.', 'transport_error');
    }

    const id = this.nextId++;
    const response = new Promise<T>((resolve, reject) => {
      const timeout = options.timeoutMs
        ? setTimeout(() => {
            pending.delete(id);
            console.warn('[robbot:dsh-sdk] request timeout', {
              id,
              method,
              processKey: summarizeProcessKey(processKey),
              timeoutMs: options.timeoutMs,
              timeoutCode: options.timeoutCode ?? 'sdk_request_timeout',
            });
            reject(new HarnessError(
              `DSH SDK request timed out after ${options.timeoutMs}ms: ${method}`,
              options.timeoutCode ?? 'sdk_request_timeout',
            ));
          }, options.timeoutMs)
        : undefined;
      pending.set(id, {
        resolve: (value) => {
          if (timeout) {
            clearTimeout(timeout);
          }
          resolve(value as T);
        },
        reject: (error) => {
          if (timeout) {
            clearTimeout(timeout);
          }
          reject(error);
        },
        timeout,
      });
    });

    if (!channel) {
      const request = pending.get(id);
      pending.delete(id);
      if (request?.timeout) {
        clearTimeout(request.timeout);
      }
      throw new HarnessError('DSH SDK transport channel is not connected.', 'transport_error');
    }

    console.info('[robbot:dsh-sdk] -> request', {
      id,
      method,
      params: summarizeRpcParams(params),
    });
    channel.send({ jsonrpc: '2.0', id, method, params });
    return response;
  }

  private async terminateProcess(processKey: string, error: { code: HarnessErrorCode; message: string }): Promise<void> {
    this.rejectPendingForProcess(processKey, error);

    const affectedSessions = [...this.sessions.values()].filter((session) => session.processKey === processKey);
    for (const session of affectedSessions) {
      this.getQueue(session.id).push({ type: 'run.interrupted', error });
      this.sessions.delete(session.id);
      this.runStates.delete(session.id);
    }

    await this.runtimeManager.stop(processKey, 'sdk');
    this.initializedByProcessKey.delete(processKey);
    this.channelByProcessKey.delete(processKey);
    this.pendingByProcessKey.delete(processKey);
    this.runLocksByProcessKey.delete(processKey);
  }

  private rejectPendingForProcess(processKey: string, error: { code: HarnessErrorCode; message: string }): void {
    const pending = this.pendingByProcessKey.get(processKey);
    for (const [id, request] of pending?.entries() ?? []) {
      if (request.timeout) {
        clearTimeout(request.timeout);
      }
      request.reject(new HarnessError(error.message, error.code));
      pending?.delete(id);
    }
  }

  private handleMessage(processKey: string, message: JsonRpcResponse | JsonRpcRequest): void {
    if ('id' in message && message.id !== undefined && ('result' in message || 'error' in message)) {
      const pending = this.pendingByProcessKey.get(processKey)?.get(message.id);
      if (!pending) {
        return;
      }

      this.pendingByProcessKey.get(processKey)?.delete(message.id);
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      console.info('[robbot:dsh-sdk] <- response', {
        id: message.id,
        ok: !message.error,
        errorCode: message.error?.code,
        errorMessage: summarizeForLog(message.error?.message),
      });
      if (message.error) {
        pending.reject(new HarnessError(message.error.message ?? 'DSH SDK request failed.', 'protocol_error', message.error));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (!('method' in message)) {
      return;
    }

    this.handleNotification(message.method, message.params);
  }

  private handleNotification(method: string, params: unknown): void {
    const sessionId = notificationSessionId(params);
    if (!sessionId) {
      return;
    }

    const state = this.runStates.get(sessionId);
    if (state && !state.promptMessageId && (method === 'session.event' || method === 'session.status')) {
      state.pendingNotifications.push({ method, params });
      return;
    }

    if (method === 'session.event' && state) {
      const event = asRecord(asRecord(params)?.event);
      console.info('[robbot:dsh-sdk] <- notification', {
        method,
        sessionId,
        eventType: event?.type,
      });
      if (!state.promptAccepted && isInboxReceipt(event, state.promptMessageId)) {
        state.promptAccepted = true;
        this.getQueue(sessionId).push({ type: 'runtime.activity' });
        return;
      }

      if (!state.promptAccepted) {
        return;
      }

      this.getQueue(sessionId).push({ type: 'runtime.activity' });

      if (event?.type === 'turn/end') {
        state.turnEndReason = turnEndReason(event);
        if (state.turnEndReason?.kind === 'error') {
          console.warn('[robbot:dsh-sdk] turn ended with error', {
            sessionId,
            code: state.turnEndReason.error?.code ?? state.turnEndReason.kind,
            message: summarizeForLog(state.turnEndReason.error?.message),
          });
        }
      } else if (event?.type === 'llm/retry') {
        console.warn('[robbot:dsh-sdk] llm retry', {
          sessionId,
          event: summarizeForLog(event),
        });
      }
    }

    if (method === 'session.status' && state) {
      if (!state.promptAccepted) {
        return;
      }

      console.info('[robbot:dsh-sdk] <- notification', {
        method,
        sessionId,
        status: asRecord(params)?.status,
      });
      this.getQueue(sessionId).push({ type: 'runtime.activity' });
      const status = asRecord(params)?.status;
      if (status === 'idle') {
        state.idle = true;
      }
      return;
    }

    for (const mapped of mapSdkNotificationToHarnessEvents(method, params)) {
      if (state) {
        state.sawTurnEnd ||= mapped.sawTurnEnd === true;
      }

      if (mapped.sawTurnStart || mapped.sawTurnEnd) {
        this.getQueue(sessionId).push({ type: 'runtime.activity' });
        continue;
      }

      this.getQueue(sessionId).push(mapped.event);
    }
  }

  private getQueue(sessionId: string): AsyncEventQueue<HarnessEvent> {
    let queue = this.eventQueues.get(sessionId);
    if (!queue) {
      queue = new AsyncEventQueue<HarnessEvent>();
      this.eventQueues.set(sessionId, queue);
    }
    return queue;
  }
}

function notificationSessionId(params: unknown): string | undefined {
  const value = asRecord(params)?.sessionId;
  return typeof value === 'string' ? value : undefined;
}

interface SdkRoute {
  provider: string;
  model: string;
  baseURL?: string;
  apiKey?: string;
  accountId?: string;
  fingerprint?: string;
}

function resolveSdkRoute(
  metadata: Record<string, unknown> | undefined,
  dshRoot: string,
  fallbackProvider: string | undefined,
  fallbackModel: string | undefined,
): SdkRoute {
  const aiRuntime = parseAiRuntime(metadata);
  if (aiRuntime) {
    return {
      provider: aiRuntime.provider === 'deepseek' ? 'deepseek-official' : 'openai',
      model: aiRuntime.model,
      baseURL: aiRuntime.apiUrl,
      apiKey: aiRuntime.key,
      accountId: aiRuntime.accountId,
      fingerprint: aiRuntime.fingerprint,
    };
  }

  const provider = normalizeProvider(envValue(dshRoot, 'ROBBOT_OPENAI_PROVIDER') ?? fallbackProvider ?? 'deepseek-official');
  const model = modelForProvider(dshRoot, provider, fallbackModel);
  const baseURL = provider === 'openai' ? envValue(dshRoot, 'OPENAI_BASE_URL') : envValue(dshRoot, 'DEEPSEEK_BASE_URL');

  return { provider, model, baseURL };
}

function envValue(dshRoot: string, name: string): string | undefined {
  return process.env[name] ?? readRobbotEnvValueFromDshRoot(dshRoot, name);
}

function parseAiRuntime(metadata: Record<string, unknown> | undefined): {
  provider: AiField;
  key: string;
  model: string;
  apiUrl?: string;
  fingerprint: string;
  accountId?: string;
} | undefined {
  const aiRuntime = asRecord(metadata?.aiRuntime);
  if (!aiRuntime) {
    return undefined;
  }

  const provider = aiRuntime.provider;
  const key = stringValue(aiRuntime.key);
  const model = stringValue(aiRuntime.model);
  const apiUrl = stringValue(aiRuntime.apiUrl);
  const fingerprint = stringValue(aiRuntime.fingerprint);
  const accountId = stringValue(metadata?.accountId);
  if ((provider !== 'deepseek' && provider !== 'openai' && provider !== 'volcengine' && provider !== 'customOpenai') || !key || !model || !fingerprint) {
    throw new HarnessError('Invalid aiRuntime metadata for DSH SDK transport.', 'protocol_error');
  }

  return {
    provider,
    key,
    model,
    apiUrl,
    fingerprint,
    accountId,
  };
}

function providerEnvOverrides(route: SdkRoute): Record<string, string> {
  const env: Record<string, string> = {};
  if (route.provider === 'openai' && route.apiKey) {
    env.OPENAI_API_KEY = route.apiKey;
    if (route.baseURL) {
      env.OPENAI_BASE_URL = route.baseURL;
    }
  }
  if (route.provider === 'deepseek-official' && route.apiKey) {
    env.DEEPSEEK_API_KEY = route.apiKey;
    if (route.baseURL) {
      env.DEEPSEEK_BASE_URL = route.baseURL;
    }
  }
  return env;
}

function hashForProcessKey(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function processKeyForRoute(workspacePath: string, route: SdkRoute): string {
  return route.accountId && route.fingerprint
    ? `dsh:${route.accountId}:${route.fingerprint}:workspace:${hashForProcessKey(workspacePath)}`
    : `workspace:${workspacePath}:provider:${route.provider}:model:${route.model}:base:${route.baseURL ?? ''}`;
}

function summarizeProcessKey(processKey: string): string {
  return `${processKey.slice(0, 48)}:${hashForProcessKey(processKey)}`;
}

function normalizeProvider(value: string): string {
  if (value === 'deepseek') {
    return 'deepseek-official';
  }
  if (value === 'chatgpt') {
    return 'openai';
  }
  return value;
}

function defaultModelForProvider(provider: string): string {
  return provider === 'openai' ? 'gpt-5.6-luna' : 'deepseek-v4-flash';
}

function modelForProvider(dshRoot: string, provider: string, fallbackModel: string | undefined): string {
  if (provider === 'openai') {
    return envValue(dshRoot, 'ROBBOT_OPENAI_MODEL')
      ?? envValue(dshRoot, 'DSH_MODEL')
      ?? fallbackModel
      ?? defaultModelForProvider(provider);
  }

  return envValue(dshRoot, 'ROBBOT_DEEPSEEK_MODEL')
    ?? envValue(dshRoot, 'DSH_MODEL')
    ?? fallbackModel
    ?? defaultModelForProvider(provider);
}

function isInboxReceipt(event: Record<string, unknown> | undefined, messageId: string | undefined): boolean {
  if (!event || event.type !== 'agent/inbox/spliced' || !messageId) {
    return false;
  }

  const inserted = asRecord(event.data)?.inserted;
  return Array.isArray(inserted)
    && inserted.some((message) => asRecord(message)?.id === messageId);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function turnEndReason(event: Record<string, unknown>): SdkTurnEndReason | undefined {
  const reason = asRecord(asRecord(event.data)?.reason);
  if (!reason) {
    return undefined;
  }

  const error = asRecord(reason.error);
  return {
    kind: typeof reason.kind === 'string' ? reason.kind : undefined,
    error: error
      ? {
          message: typeof error.message === 'string' ? error.message : undefined,
          code: typeof error.code === 'string' ? error.code : undefined,
        }
      : undefined,
  };
}

function errorFromTurnEndReason(reason: SdkTurnEndReason): { message: string; code?: string } {
  const code = reason.error?.code ?? reason.kind ?? 'unknown_turn_end_reason';
  const message = reason.error?.message
    ?? `DSH SDK turn ended with reason: ${reason.kind ?? 'unknown'}`;
  return { code, message };
}

function summarizeForLog(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  }

  if (value && typeof value === 'object') {
    const summary = JSON.stringify(value, (_key, child) => {
      if (typeof child === 'string' && child.length > 500) {
        return `${child.slice(0, 500)}...`;
      }
      return child;
    });
    return summary.length > 1000 ? `${summary.slice(0, 1000)}...` : summary;
  }

  return value;
}

function summarizeRpcParams(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) {
    return summarizeForLog(value);
  }

  const contentBlocks = record.contentBlocks;
  return {
    sessionId: stringValue(record.sessionId),
    provider: stringValue(record.provider),
    model: stringValue(record.model),
    cwd: stringValue(record.cwd),
    contentBlockCount: Array.isArray(contentBlocks) ? contentBlocks.length : undefined,
    textLength: Array.isArray(contentBlocks)
      ? contentBlocks.reduce((total, block) => {
          const text = stringValue(asRecord(block)?.text);
          return total + (text?.length ?? 0);
        }, 0)
      : undefined,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class AsyncEventQueue<T> {
  private readonly values: Array<T | undefined> = [];
  private readonly waiters: Array<{
    resolve: (value: T | undefined) => void;
    reject: (error: Error) => void;
    timeout?: ReturnType<typeof setTimeout>;
  }> = [];

  push(value: T | undefined): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      if (waiter.timeout) {
        clearTimeout(waiter.timeout);
      }
      waiter.resolve(value);
      return;
    }
    this.values.push(value);
  }

  async shift(timeoutMs?: number): Promise<T | undefined> {
    if (this.values.length > 0) {
      return this.values.shift();
    }

    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timeout: undefined as ReturnType<typeof setTimeout> | undefined,
      };
      if (timeoutMs) {
        waiter.timeout = setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) {
            this.waiters.splice(index, 1);
          }
          reject(new HarnessError(`DSH SDK did not emit a protocol event for ${timeoutMs}ms.`, 'sdk_run_timeout'));
        }, timeoutMs);
      }
      this.waiters.push(waiter);
    });
  }
}
