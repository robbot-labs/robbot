import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ApprovalInput, CreateSessionInput, HarnessCapabilities, HarnessEvent, HarnessSession, RunInput } from '@robbot/core';
import { HarnessError } from '@robbot/core';
import { DshRuntimeManager } from '../runtime/dsh-runtime-manager.js';
import type { HarnessTransport } from './transport.js';

type Frame = { rpcId?: string; payload?: Record<string, unknown> };
const WEB_READY_TIMEOUT_MS = Number(process.env.ROBBOT_DSH_WEB_READY_TIMEOUT_MS ?? 120_000);

/** DSH Desktop's native HTTP-upstream/WebSocket-downstream session surface. */
export class WebTransport implements HarnessTransport {
  readonly mode = 'web' as const;
  private readonly processSessionId = `robbot-web-${randomUUID()}`;
  private readonly sessions = new Map<string, string>();
  private readonly approvals = new Map<string, { rpcId: string; approvalId: string }>();
  private started = false;
  private runtimeFingerprint = '';
  private startPromise?: Promise<void>;
  private startingFingerprint = '';
  private startVersion = 0;
  private readonly port = 3187 + (process.pid % 1000);

  constructor(private readonly runtimeManager: DshRuntimeManager) {}

  capabilities(): HarnessCapabilities {
    return { streaming: 'runtime-events', toolEvents: true, cancelCurrentRun: true, terminateRuntime: true, approval: true, sessionResume: true };
  }

  async warmup(input: CreateSessionInput): Promise<void> {
    await this.ensureServer(input.metadata);
  }

  async webUrl(metadata?: Record<string, unknown>): Promise<string> {
    await this.ensureServer(metadata);
    const url = new URL(this.baseUrl());
    url.searchParams.set('dsh-desktop-mode', 'compatibility');
    url.searchParams.set('dsh-desktop-platform', process.platform);
    return url.href;
  }

  async createSession(input: CreateSessionInput): Promise<HarnessSession> {
    await this.ensureServer(input.metadata);
    const requested = typeof input.metadata?.robbotSessionId === 'string'
      ? `robbot-${input.metadata.robbotSessionId}`.replace(/[^a-zA-Z0-9_-]/g, '-')
      : undefined;
    const result = await this.call<{ sessionId: string }>('session.create', {
      cwd: input.workspacePath,
      ...(requested === undefined ? {} : { sessionId: requested }),
    });
    this.sessions.set(result.sessionId, result.sessionId);
    return { id: result.sessionId, workspacePath: input.workspacePath, createdAt: new Date().toISOString(), metadata: input.metadata };
  }

  async *run(sessionId: string, input: RunInput): AsyncIterable<HarnessEvent> {
    await this.ensureServer(input.metadata);
    const abort = new AbortController();
    const queue = new AsyncQueue<Frame>();
    const stream = this.readMux(sessionId, abort.signal, queue).catch((error) => {
      queue.fail(error instanceof Error ? error : new Error(String(error)));
    });
    yield { type: 'run.started', runId: randomUUID(), sessionId };
    try {
      await this.call('session.prompt', { sessionId, mode: 'queue', content: [{ type: 'text', text: input.prompt }] });
      let completed = false;
      while (!completed) {
        const frame = await queue.take();
        if (frame === undefined) break;
        const event = mapFrame(sessionId, frame, this.approvals);
        if (event === undefined) continue;
        completed = event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.interrupted';
        yield event;
      }
    } finally {
      abort.abort();
      await stream.catch(() => undefined);
    }
  }

  async cancel(sessionId: string): Promise<void> {
    await this.call('session.cancel', { sessionId });
  }

  async terminate(sessionId: string): Promise<void> {
    await this.cancel(sessionId).catch(() => undefined);
    this.sessions.delete(sessionId);
  }

  async dispose(): Promise<void> {
    this.started = false;
    this.runtimeFingerprint = '';
    this.sessions.clear();
    this.approvals.clear();
  }

  async approve(sessionId: string, input: ApprovalInput): Promise<void> {
    const pending = this.approvals.get(`${sessionId}:${input.approvalId}`);
    if (!pending) throw new HarnessError(`No pending DSH approval: ${input.approvalId}`, 'unsupported_capability');
    await this.post('/api/respond', {
      type: 'client-response',
      rpcId: pending.rpcId,
      result: { ok: true, value: { sessionId, approvalId: input.approvalId, outcome: input.approved ? 'allowed-once' : 'rejected' } },
    });
    this.approvals.delete(`${sessionId}:${input.approvalId}`);
  }

  private async ensureServer(metadata?: Record<string, unknown>): Promise<void> {
    const dshHome = typeof metadata?.dshHome === 'string' && metadata.dshHome.trim()
      ? metadata.dshHome
      : undefined;
    const fingerprint = runtimeFingerprint(metadata, dshHome);
    if (this.started && this.runtimeFingerprint === fingerprint) return;
    if (this.startPromise && this.startingFingerprint === fingerprint) {
      return this.startPromise;
    }
    if (this.startPromise && this.startingFingerprint !== fingerprint) {
      await this.runtimeManager.stop(this.processSessionId, 'web');
      this.started = false;
      this.sessions.clear();
    }
    if (this.started && this.runtimeFingerprint !== fingerprint) {
      await this.runtimeManager.stop(this.processSessionId, 'web');
      this.started = false;
      this.sessions.clear();
    }
    this.startingFingerprint = fingerprint;
    const version = ++this.startVersion;
    const startPromise = this.startServer(metadata, dshHome, fingerprint, version);
    this.startPromise = startPromise;
    try {
      await startPromise;
    } finally {
      if (this.startPromise === startPromise) {
        this.startPromise = undefined;
        this.startingFingerprint = '';
      }
    }
  }

  private async startServer(metadata: Record<string, unknown> | undefined, dshHome: string | undefined, fingerprint: string, version: number): Promise<void> {
    const runtime = this.runtimeManager.resolveRuntime();
    const processHandle = await this.runtimeManager.start(this.processSessionId, 'web', {
      ROBBOT_DSH_WEB_PORT: String(this.port),
      DSH_HOME: dshHome ?? path.resolve(runtime.root, '../../.dsh-home'),
      ...runtimeEnv(metadata),
    });
    const base = this.baseUrl();
    const deadline = Date.now() + WEB_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${base}/api/session.list`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: 'session.list', payload: {} }) });
        if (response.ok && version === this.startVersion) { this.started = true; this.runtimeFingerprint = fingerprint; return; }
      } catch { /* wait for webserver */ }
      if (!processHandle.isRunning()) {
        const stderr = processHandle.getRecentStderr();
        throw new HarnessError(
          stderr ? `DSH Desktop web host exited before becoming ready.\n${stderr}` : 'DSH Desktop web host exited before becoming ready.',
          'transport_error',
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    console.warn('[robbot:dsh-web] DSH web host did not become ready before timeout', {
      base,
      timeoutMs: WEB_READY_TIMEOUT_MS,
    });
    throw new HarnessError('DSH Desktop web host did not become ready.', 'transport_error');
  }

  private baseUrl(): string { return `http://127.0.0.1:${this.port}`; }

  private async call<T>(method: string, payload: unknown): Promise<T> {
    const rpcId = randomUUID();
    const response = await this.post(`/api/${method}`, { type: 'client-request', rpcId, method, payload });
    const body = await response.json() as { rpcId?: string; result?: { ok?: boolean; value?: T; error?: { message?: string } } };
    if (body.rpcId !== rpcId || body.result?.ok !== true) throw new HarnessError(body.result?.error?.message ?? `DSH API call failed: ${method}`, 'protocol_error');
    return body.result.value as T;
  }

  private async post(pathname: string, body: unknown): Promise<Response> {
    const response = await fetch(`${this.baseUrl()}${pathname}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new HarnessError(`DSH Desktop API returned HTTP ${response.status}.`, 'transport_error');
    return response;
  }

  private async readMux(sessionId: string, signal: AbortSignal, queue: AsyncQueue<Frame>): Promise<void> {
    const Socket = (globalThis as unknown as { WebSocket?: WebSocketConstructor }).WebSocket;
    if (!Socket) throw new HarnessError('Electron WebSocket is unavailable.', 'transport_error');
    const socket = new Socket(`${this.baseUrl().replace(/^http/, 'ws')}/api/events.mux`);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settleOpen = (): void => { if (!settled) { settled = true; resolve(); } };
      const settleError = (): void => { if (!settled) { settled = true; reject(new HarnessError('DSH Desktop event stream failed.', 'transport_error')); } };
      socket.addEventListener('open', settleOpen, { once: true });
      socket.addEventListener('error', settleError, { once: true });
      socket.addEventListener('close', settleError, { once: true });
      if (signal.aborted) { socket.close(); settleError(); }
    });
    const onMessage = (event: { data?: unknown }): void => {
      if (typeof event.data !== 'string') return;
      try {
        const parsed = JSON.parse(event.data) as Frame;
        const payload = parsed.payload;
        if (payload?.sessionId === sessionId || payload?.type === 'session/subscribed') queue.push(parsed);
      } catch (error) {
        console.warn('[robbot:dsh-web] dropped malformed mux frame', error);
      }
    };
    const onClose = (): void => queue.close();
    socket.addEventListener('message', onMessage);
    socket.addEventListener('close', onClose, { once: true });
    const onAbort = (): void => { if (socket.readyState === 0 || socket.readyState === 1) socket.close(); };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      await new Promise<void>((resolve) => socket.addEventListener('close', () => resolve(), { once: true }));
    } finally {
      signal.removeEventListener('abort', onAbort);
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('close', onClose);
      onAbort();
      queue.close();
    }
  }
}

type WebSocketConstructor = new (url: string) => WebSocketLike;
type WebSocketLike = {
  readyState: number;
  addEventListener(type: string, listener: (event: { data?: unknown }) => void, options?: { once?: boolean }): void;
  removeEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
  close(): void;
};

class AsyncQueue<T> {
  private values: T[] = [];
  private waiters: Array<{ resolve: (value: T | undefined) => void; reject: (error: Error) => void }> = [];
  private closed = false;
  private failure: Error | undefined;
  push(value: T): void { const waiter = this.waiters.shift(); if (waiter) waiter.resolve(value); else this.values.push(value); }
  take(): Promise<T | undefined> { if (this.values.length) return Promise.resolve(this.values.shift()); if (this.failure) return Promise.reject(this.failure); if (this.closed) return Promise.resolve(undefined); return new Promise((resolve, reject) => this.waiters.push({ resolve, reject })); }
  fail(error: Error): void { this.failure = error; this.closed = true; for (const waiter of this.waiters.splice(0)) waiter.reject(error); }
  close(): void { this.closed = true; for (const waiter of this.waiters.splice(0)) waiter.resolve(undefined); }
}

function runtimeEnv(metadata?: Record<string, unknown>): Record<string, string | undefined> {
  const ai = metadata?.aiRuntime as Record<string, unknown> | undefined;
  return {
    DEEPSEEK_API_KEY: ai?.provider === 'deepseek' && typeof ai.key === 'string' ? ai.key : undefined,
    OPENAI_API_KEY: ai?.provider === 'openai' && typeof ai.key === 'string' ? ai.key : undefined,
    DEEPSEEK_BASE_URL: ai?.provider === 'deepseek' && typeof ai.apiUrl === 'string' ? ai.apiUrl : undefined,
    OPENAI_BASE_URL: ai?.provider === 'openai' && typeof ai.apiUrl === 'string' ? ai.apiUrl : undefined,
    DSH_PROVIDER: typeof ai?.dshProvider === 'string' ? ai.dshProvider : typeof ai?.provider === 'string' ? (ai.provider === 'openai' ? 'openai' : 'deepseek-official') : undefined,
    DSH_MODEL: typeof ai?.model === 'string' ? ai.model : undefined,
  };
}

function runtimeFingerprint(metadata: Record<string, unknown> | undefined, dshHome: string | undefined): string {
  const ai = metadata?.aiRuntime as Record<string, unknown> | undefined;
  const pluginFingerprint = runtimePluginsFingerprint();
  if (typeof ai?.fingerprint === 'string') return `${ai.fingerprint}:${pluginFingerprint}`;
  return [
    typeof metadata?.accountHash === 'string' ? metadata.accountHash : '',
    typeof ai?.provider === 'string' ? ai.provider : '',
    typeof ai?.model === 'string' ? ai.model : '',
    typeof ai?.apiUrl === 'string' ? ai.apiUrl : '',
    typeof ai?.keyFingerprint === 'string' ? ai.keyFingerprint : '',
    dshHome ?? '',
    pluginFingerprint,
  ].join(':');
}

function runtimePluginsFingerprint(): string {
  const manifestPath = runtimePluginsManifestPath();
  if (!manifestPath) {
    return 'runtime-plugins:none';
  }

  try {
    return `runtime-plugins:${createHash('sha256').update(readFileSync(manifestPath)).digest('hex').slice(0, 16)}`;
  } catch {
    return 'runtime-plugins:unreadable';
  }
}

function runtimePluginsManifestPath(): string | undefined {
  const candidates = [
    path.resolve(process.cwd(), 'runtime-plugins', 'manifest.json'),
    path.resolve(process.cwd(), '..', '..', 'runtime-plugins', 'manifest.json'),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function mapFrame(sessionId: string, frame: Frame, approvals: Map<string, { rpcId: string; approvalId: string }>): HarnessEvent | undefined {
  const payload = frame.payload;
  if (!payload) return undefined;
  if (payload.type === 'approval/requested' && typeof payload.approvalId === 'string' && typeof frame.rpcId === 'string') {
    approvals.set(`${sessionId}:${payload.approvalId}`, { rpcId: frame.rpcId, approvalId: payload.approvalId });
    return { type: 'approval.required', approval: { id: payload.approvalId, sessionId, title: String(payload.toolName ?? 'Tool approval'), description: typeof payload.reason === 'string' ? payload.reason : undefined, metadata: payload } };
  }
  if (payload.type !== 'session/event') return undefined;
  const event = payload.event as Record<string, unknown> | undefined;
  if (!event || typeof event.type !== 'string') return undefined;
  const data = (event.data ?? {}) as Record<string, unknown>;
  if (event.type === 'assistant/chunk') {
    const chunk = data.chunk as Record<string, unknown> | undefined;
    if (chunk?.type === 'reasoning-delta' && typeof chunk.text === 'string') return { type: 'assistant.reasoning.delta', text: chunk.text };
    return chunk?.type === 'text-delta' && typeof chunk.text === 'string' ? { type: 'assistant.delta', text: chunk.text } : undefined;
  }
  if (event.type === 'assistant/message') return { type: 'assistant.message', text: textFromContent((data.message as Record<string, unknown> | undefined)?.content ?? data.content) };
  if (event.type === 'tool/call') return { type: 'tool.started', toolCallId: String(data.callId ?? ''), name: String(data.name ?? 'tool'), input: data.arguments };
  if (event.type === 'tool/result') return { type: 'tool.completed', toolCallId: String(((data.message as Record<string, unknown> | undefined)?.source as Record<string, unknown> | undefined)?.callId ?? ''), result: data.message ?? data };
  if (event.type === 'turn/end') return { type: 'run.completed', runId: sessionId };
  if (event.type === 'session/error') return { type: 'run.failed', runId: sessionId, error: { message: String(data.message ?? 'DSH session failed'), code: 'transport_error' } };
  return { type: 'runtime.activity' };
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((item) => typeof item === 'object' && item !== null && 'text' in item ? String((item as { text?: unknown }).text ?? '') : '').join('');
}
