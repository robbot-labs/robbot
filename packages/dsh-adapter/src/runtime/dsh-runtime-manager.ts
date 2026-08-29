import { HarnessError } from '@robbot/core';

import { DshProcess } from '../transport/process/dsh-process.js';
import type { DshProcessProtocol } from '../transport/process/dsh-process.js';
import { DshRuntimeResolver, type ResolvedDshRuntime } from './dsh-runtime-resolver.js';

export type DshRuntimeStatus = 'missing' | 'not_installed' | 'ready' | 'running';

export class DshRuntimeManager {
  private readonly processes = new Map<string, DshProcess>();
  private readonly starting = new Map<string, Promise<DshProcess>>();

  constructor(private readonly resolver = new DshRuntimeResolver()) {}

  resolveRuntime(): ResolvedDshRuntime {
    return this.resolver.resolveRuntime();
  }

  async verifyRuntime(): Promise<void> {
    if (!this.resolver.isRuntimeCheckoutPresent()) {
      throw new HarnessError('DSH submodule is missing. Run: git submodule update --init --recursive', 'runtime_not_found');
    }

    if (!this.resolver.isRuntimeInstalled()) {
      throw new HarnessError('DSH runtime is not installed or built. Run: pnpm dsh:setup', 'runtime_not_ready');
    }
  }

  async start(
    sessionId: string,
    protocol?: DshProcessProtocol,
    envOverrides: Record<string, string | undefined> = {},
  ): Promise<DshProcess> {
    await this.verifyRuntime();
    const runtime = this.resolveRuntime();
    const selectedProtocol = protocol ?? runtime.config.protocol;
    const processKey = `${selectedProtocol}:${sessionId}`;
    const existing = this.processes.get(processKey);
    if (existing?.isRunning()) {
      return existing;
    }
    if (existing) {
      this.processes.delete(processKey);
    }
    const pending = this.starting.get(processKey);
    if (pending) {
      return pending;
    }

    const startPromise = (async () => {
      const processHandle = new DshProcess(
        runtime.root,
        selectedProtocol,
        configPathForProtocol(selectedProtocol, runtime.config.protocol, runtime.config.configPath),
        envOverrides,
      );
      await processHandle.start();
      this.processes.set(processKey, processHandle);
      return processHandle;
    })();
    this.starting.set(processKey, startPromise);
    try {
      return await startPromise;
    } finally {
      this.starting.delete(processKey);
    }
  }

  async stop(sessionId: string, protocol?: DshProcessProtocol): Promise<void> {
    const runtime = this.resolveRuntime();
    const selectedProtocol = protocol ?? runtime.config.protocol;
    const processKey = `${selectedProtocol}:${sessionId}`;
    const pending = this.starting.get(processKey);
    this.starting.delete(processKey);
    const processHandle = this.processes.get(processKey) ?? await pending?.catch(() => undefined);
    if (!processHandle) {
      return;
    }

    await processHandle.stop();
    this.processes.delete(processKey);
  }

  async restart(sessionId: string, protocol?: DshProcessProtocol): Promise<DshProcess> {
    await this.stop(sessionId, protocol);
    return this.start(sessionId, protocol);
  }

  status(sessionId?: string): DshRuntimeStatus {
    if (!this.resolver.isRuntimeCheckoutPresent()) {
      return 'missing';
    }
    if (!this.resolver.isRuntimeInstalled()) {
      return 'not_installed';
    }
    if (sessionId && (this.processes.has(`sdk:${sessionId}`) || this.processes.has(`acp:${sessionId}`))) {
      return 'running';
    }
    return 'ready';
  }

  async stopAll(): Promise<void> {
    const startingEntries = [...this.starting.entries()];
    this.starting.clear();
    const entries = [...this.processes.entries()];
    const startedWhileStopping = await Promise.all(startingEntries.map(async ([processKey, pending]) => {
      const processHandle = await pending.catch(() => undefined);
      return processHandle ? [processKey, processHandle] as const : undefined;
    }));
    await Promise.all([...entries, ...startedWhileStopping.filter((entry): entry is readonly [string, DshProcess] => entry !== undefined)].map(async ([processKey, processHandle]) => {
      await processHandle.stop();
      this.processes.delete(processKey);
    }));
  }
}

function configPathForProtocol(protocol: DshProcessProtocol, configuredProtocol: DshProcessProtocol, configuredPath: string): string {
  if (protocol === 'web') {
    return '../../config/dsh-web.cordis.patch.yml';
  }

  if (process.env.ROBBOT_DSH_CONFIG) {
    return process.env.ROBBOT_DSH_CONFIG;
  }

  if (protocol === configuredProtocol) {
    return configuredPath;
  }

  if (protocol === 'sdk') {
    return '../../config/dsh-sdk-flash.cordis.yml';
  }
  return '../../config/dsh-acp-flash.cordis.yml';
}
