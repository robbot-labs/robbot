import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { accessSync, constants, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { HarnessError } from '@robbot/core';

import { StdioChannel } from './stdio-channel.js';

export type DshProcessProtocol = 'sdk' | 'acp' | 'web';

export class DshProcess {
  private child?: ChildProcessWithoutNullStreams;
  private channel?: StdioChannel;
  private exited = false;
  private recentStderr = '';
  private recentStdout = '';
  private webAuthUrl?: string;
  constructor(
    private readonly cwd: string,
    private readonly protocol: DshProcessProtocol,
    private readonly configPath = 'examples/acp-agent/cordis.yml',
    private readonly envOverrides: Record<string, string | undefined> = {},
  ) {}

  async start(): Promise<StdioChannel> {
    if (this.channel) {
      return this.channel;
    }
    this.exited = false;

    const nodeExecutable = resolveNodeExecutable();
    const builtCli = isBuiltCliRuntime(this.cwd);
    const bin = builtCli
      ? 'lib/bin.js'
      : this.protocol === 'acp'
        ? 'packages/examples/acp-demo/src/bin.ts'
        : this.protocol === 'sdk'
          ? 'packages/examples/jsonrpc-demo/src/bin.ts'
          : 'apps/cli/src/bin.ts';
    const args = builtCli
      ? builtCliArgs(this.cwd, this.protocol, bin, this.configPath, this.envOverrides)
      : this.protocol === 'sdk'
        ? ['--import', 'tsx', bin, this.configPath]
        : this.protocol === 'acp'
          ? ['--import', 'tsx', bin, '--config', this.configPath]
          : ['--import', 'tsx/esm', bin, 'web', '--host', '127.0.0.1', '--port', envPort(this.envOverrides), '--no-open'];
    console.info('[robbot:dsh-process] starting DSH process', {
      cwd: this.cwd,
      protocol: this.protocol,
      nodeExecutable,
      args,
    });

    // Product runtime config is passed by Electron Main through envOverrides.
    // Reading Robbot's .env here is intentionally retained only as a local-development
    // fallback for adapter-level runs that do not provide metadata.aiRuntime.
    const robbotEnv = readRobbotEnvFromDshRoot(this.cwd);
    const launchEnv: Record<string, string | undefined> = {
      ...process.env,
      ROBBOT_OPENAI_PROVIDER: process.env.ROBBOT_OPENAI_PROVIDER ?? robbotEnv.ROBBOT_OPENAI_PROVIDER,
      ROBBOT_OPENAI_MODEL: process.env.ROBBOT_OPENAI_MODEL ?? robbotEnv.ROBBOT_OPENAI_MODEL,
      ROBBOT_DEEPSEEK_MODEL: process.env.ROBBOT_DEEPSEEK_MODEL ?? robbotEnv.ROBBOT_DEEPSEEK_MODEL,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? robbotEnv.OPENAI_API_KEY,
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL ?? robbotEnv.OPENAI_BASE_URL,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? robbotEnv.DEEPSEEK_API_KEY,
      DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL ?? robbotEnv.DEEPSEEK_BASE_URL,
      DSH_MODEL: process.env.DSH_MODEL ?? robbotEnv.DSH_MODEL,
      DSH_PERMISSION_MODE: process.env.DSH_PERMISSION_MODE ?? 'workspace-write',
      DSH_CORDIS_CONFIG: this.configPath,
      TSX_TSCONFIG_PATH: path.join(this.cwd, 'tsconfig.json'),
      ...this.envOverrides,
    };
    if (shouldRunElectronAsNode(nodeExecutable)) {
      launchEnv.ELECTRON_RUN_AS_NODE = '1';
    }
    const dshHome = (launchEnv as Record<string, string | undefined>).DSH_HOME;
    if (this.protocol === 'web' && dshHome) {
      syncWebProfileBundles(this.cwd, dshHome, launchEnv);
      const patchPath = resolveConfigPath(this.cwd, this.configPath);
      const profilePatchPath = path.join(dshHome, 'profiles', 'web', 'cordis.patch.yml');
      mkdirSync(path.dirname(profilePatchPath), { recursive: true });
      writeFileSync(profilePatchPath, webProfilePatch(patchPath, this.cwd, launchEnv));
      console.info('[robbot:dsh-process] projected web profile patch', { profilePatchPath });
    }
    ensureRuntimePluginResolution(this.cwd, this.configPath, launchEnv);
    console.info('[robbot:dsh-process] launch env summary', summarizeLaunchEnv(launchEnv));

    this.child = spawn(nodeExecutable, args, {
      cwd: this.cwd,
      stdio: 'pipe',
      env: launchEnv,
    });
    console.info('[robbot:dsh-process] DSH process spawned', {
      protocol: this.protocol,
      pid: this.child.pid,
    });

    this.child.once('error', (error: Error) => {
      console.error('[robbot:dsh-process] failed to start DSH process', error);
      throw new HarnessError('Failed to start DSH process.', 'transport_error', error);
    });

    this.child.once('exit', (code, signal) => {
      console.info('[robbot:dsh-process] DSH process exited', { protocol: this.protocol, code, signal });
      this.exited = true;
      this.child = undefined;
      this.channel = undefined;
    });

    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => {
      this.recentStderr = `${this.recentStderr}${chunk}`.slice(-8_000);
      console.warn('[robbot:dsh-process:stderr]', chunk.trim());
    });
    if (this.protocol === 'web') {
      this.child.stdout.setEncoding('utf8');
      this.child.stdout.on('data', (chunk: string) => {
        this.recentStdout = `${this.recentStdout}${chunk}`.slice(-8_000);
        const match = /dsh web:\s+(http:\/\/[^\s]+)/u.exec(this.recentStdout);
        if (match) {
          this.webAuthUrl = match[1];
        }
      });
    }

    this.channel = new StdioChannel(this.child.stdin, this.child.stdout, this.child.stderr);
    return this.channel;
  }

  isRunning(): boolean {
    return Boolean(this.child && !this.child.killed && !this.exited);
  }

  getChannel(): StdioChannel {
    if (!this.channel) {
      throw new HarnessError('DSH process has not been started.', 'transport_error');
    }

    return this.channel;
  }

  getRecentStderr(): string {
    return this.recentStderr.trim();
  }

  getWebAuthUrl(): string | undefined {
    return this.webAuthUrl;
  }

  async stop(): Promise<void> {
    if (!this.child || this.child.killed) {
      return;
    }

    const child = this.child;
    const startedAt = Date.now();
    console.info('[robbot:dsh-process] stopping DSH process', { protocol: this.protocol, pid: child.pid });
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(killTimer);
        resolve();
      };
      const killTimer = setTimeout(() => {
        console.warn('[robbot:dsh-process] DSH process did not exit after SIGTERM; sending SIGKILL', {
          protocol: this.protocol,
          pid: child.pid,
        });
        child.kill('SIGKILL');
      }, 5_000);

      child.once('exit', finish);
      child.kill('SIGTERM');
    });
    console.info('[robbot:dsh-process] stopped DSH process', {
      protocol: this.protocol,
      pid: child.pid,
      elapsedMs: Date.now() - startedAt,
    });
    this.exited = true;
    this.child = undefined;
    this.channel = undefined;
  }
}

function ensureRuntimePluginResolution(
  dshRoot: string,
  configPath: string,
  env: Record<string, string | undefined>,
): void {
  const pluginNodeModules = resolveRuntimePluginNodeModules(dshRoot, env);
  if (!pluginNodeModules) {
    return;
  }

  const configNodeModules = path.join(path.dirname(resolveConfigPath(dshRoot, configPath)), 'node_modules');
  linkNodeModules(configNodeModules, pluginNodeModules, 'config');

  const dshHome = env.DSH_HOME;
  if (dshHome) {
    linkRuntimePluginPackages(
      path.join(dshHome, 'profiles', 'node_modules'),
      pluginNodeModules,
      path.resolve(pluginNodeModules, '..', 'package.json'),
    );
  }
}

function resolveConfigPath(dshRoot: string, configPath: string): string {
  if (path.isAbsolute(configPath) && existsSync(configPath)) {
    return configPath;
  }

  const directPath = path.resolve(dshRoot, configPath);
  if (existsSync(directPath)) {
    return directPath;
  }

  const configName = path.basename(configPath);
  for (const root of configSearchRoots(dshRoot)) {
    const candidate = path.join(root, 'config', configName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return directPath;
}

function configSearchRoots(dshRoot: string): string[] {
  const roots: string[] = [];
  for (const start of [dshRoot, process.cwd()]) {
    let current = path.resolve(start);
    while (!roots.includes(current)) {
      roots.push(current);
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }
  return roots;
}

function resolveRuntimePluginNodeModules(
  dshRoot: string,
  env: Record<string, string | undefined>,
): string | undefined {
  const candidates = [
    env.ROBBOT_RUNTIME_PLUGINS_NODE_MODULES,
    path.resolve(dshRoot, '../../runtime-plugins/node_modules'),
    path.resolve(dshRoot, '../../../../runtime-plugins/node_modules'),
    ...(isBuiltCliRuntime(dshRoot) ? [path.resolve(dshRoot, 'node_modules')] : []),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function linkNodeModules(linkPath: string, targetPath: string, label: string): void {
  try {
    if (existsSync(linkPath)) {
      const existing = lstatSync(linkPath);
      if (existing.isSymbolicLink()) {
        const currentTarget = path.resolve(path.dirname(linkPath), readlinkSync(linkPath));
        if (currentTarget === targetPath && existsSync(currentTarget)) {
          return;
        }
        unlinkSync(linkPath);
      } else {
        console.warn('[robbot:dsh-process] runtime plugin node_modules link target already exists', {
          label,
          linkPath,
        });
        return;
      }
    }

    mkdirSync(path.dirname(linkPath), { recursive: true });
    symlinkSync(targetPath, linkPath, 'dir');
    console.info('[robbot:dsh-process] linked runtime plugin node_modules', {
      label,
      linkPath,
      targetPath,
    });
  } catch (error) {
    console.warn('[robbot:dsh-process] failed to link runtime plugin node_modules', {
      label,
      linkPath,
      targetPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function linkRuntimePluginPackages(modulesDir: string, pluginNodeModules: string, runtimePluginsManifestPath: string): void {
  const runtimePluginsRoot = path.dirname(runtimePluginsManifestPath);
  const packageNames = runtimePluginPackageNames(runtimePluginsManifestPath, path.join(runtimePluginsRoot, 'manifest.json'));
  mkdirSync(modulesDir, { recursive: true });
  for (const packageName of packageNames) {
    const targetPath = path.join(pluginNodeModules, packageName);
    if (!existsSync(targetPath)) {
      console.warn('[robbot:dsh-process] runtime plugin package is not installed', {
        packageName,
        targetPath,
      });
      continue;
    }
    linkNodeModules(path.join(modulesDir, packageName), targetPath, `profile:${packageName}`);
  }
}

function runtimePluginPackageNames(packageManifestPath: string, runtimePluginsManifestPath?: string): string[] {
  const names = new Set<string>();
  try {
    const manifest = JSON.parse(readFileSync(packageManifestPath, 'utf8')) as {
      name?: unknown;
      dependencies?: Record<string, unknown>;
      optionalDependencies?: Record<string, unknown>;
    };
    if (manifest.name === 'robbot-runtime-plugins') {
      for (const packageName of [
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
      ]) {
        names.add(packageName);
      }
    }
  } catch (error) {
    console.warn('[robbot:dsh-process] failed to read runtime plugin package manifest', {
      manifestPath: packageManifestPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (runtimePluginsManifestPath) {
    for (const packageName of declaredRuntimePluginPackageNames(runtimePluginsManifestPath)) {
      names.add(packageName);
    }
  }

  return [...names];
}

function declaredRuntimePluginPackageNames(runtimePluginsManifestPath: string): string[] {
  return runtimePlugins(runtimePluginsManifestPath)
    .map((plugin) => plugin.name);
}

function enabledRuntimePluginPackageNames(runtimePluginsManifestPath: string): string[] {
  return enabledRuntimePlugins(runtimePluginsManifestPath).map((plugin) => plugin.name);
}

function enabledRuntimePlugins(runtimePluginsManifestPath: string): Array<{ name: string; id: string; config: Record<string, unknown> }> {
  return runtimePlugins(runtimePluginsManifestPath).filter((plugin) => plugin.enabled);
}

function runtimePlugins(runtimePluginsManifestPath: string): Array<{ name: string; id: string; enabled: boolean; config: Record<string, unknown> }> {
  try {
    const manifest = JSON.parse(readFileSync(runtimePluginsManifestPath, 'utf8')) as {
      plugins?: Array<{ name?: unknown; id?: unknown; enabled?: unknown; config?: unknown }>;
    };
    return (Array.isArray(manifest.plugins) ? manifest.plugins : [])
      .filter((plugin) => typeof plugin.name === 'string')
      .map((plugin) => ({
        name: plugin.name as string,
        id: typeof plugin.id === 'string' ? plugin.id : plugin.name as string,
        enabled: plugin.enabled === true,
        config: plugin.config && typeof plugin.config === 'object' && !Array.isArray(plugin.config)
          ? plugin.config as Record<string, unknown>
          : {},
      }));
  } catch (error) {
    console.warn('[robbot:dsh-process] failed to read runtime plugin enablement manifest', {
      runtimePluginsManifestPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function webProfilePatch(
  basePatchPath: string,
  dshRoot: string,
  env: Record<string, string | undefined>,
): string {
  const basePatch = readFileSync(basePatchPath, 'utf8').trimEnd();
  const pluginNodeModules = resolveRuntimePluginNodeModules(dshRoot, env);
  const runtimePluginsRoot = pluginNodeModules ? path.resolve(pluginNodeModules, '..') : undefined;
  const managedPluginPackages = runtimePluginsRoot
    ? runtimePluginPackageNames(path.join(runtimePluginsRoot, 'package.json'), path.join(runtimePluginsRoot, 'manifest.json'))
    : [];
  const enabledPluginPackages = runtimePluginsRoot
    ? enabledRuntimePluginPackageNames(path.join(runtimePluginsRoot, 'manifest.json'))
    : [];
  let patch = stripPatchRowsById(basePatch, managedPluginPackages);
  if (enabledPluginPackages.length === 0) {
    patch = stripPatchRowsById(patch, ['ui-sidebar']);
  }
  return normalizePatchList(patch);
}

function syncWebProfileBundles(dshRoot: string, dshHome: string, env: Record<string, string | undefined>): void {
  const profileDir = path.join(dshHome, 'profiles', 'web');
  const manifestPath = path.join(profileDir, 'package.json');
  mkdirSync(profileDir, { recursive: true });

  const pluginNodeModules = resolveRuntimePluginNodeModules(dshRoot, env);
  const runtimePluginsRoot = pluginNodeModules ? path.resolve(pluginNodeModules, '..') : undefined;
  const installedPluginPackages = runtimePluginsRoot
    ? runtimePluginPackageNames(path.join(runtimePluginsRoot, 'package.json'), path.join(runtimePluginsRoot, 'manifest.json'))
    : [];
  const enabledPluginPackages = runtimePluginsRoot
    ? enabledRuntimePluginPackageNames(path.join(runtimePluginsRoot, 'manifest.json'))
    : [];
  const manifest = readWebProfileManifest(manifestPath);
  const baseBundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'];
  const existingBundles = Array.isArray(manifest.dsh?.profile?.bundles)
    ? manifest.dsh.profile.bundles.filter((value): value is string => typeof value === 'string')
    : baseBundles;
  const existingUnmanagedBundles = uniqueStrings(existingBundles)
    .filter((value) => !baseBundles.includes(value))
    .filter((value) => !installedPluginPackages.includes(value));
  const bundles = uniqueStrings([...baseBundles, ...existingUnmanagedBundles, ...enabledPluginPackages]);

  const nextManifest = {
    ...manifest,
    name: typeof manifest.name === 'string' ? manifest.name : 'dsh-profile-web',
    private: manifest.private ?? true,
    dependencies: manifest.dependencies ?? {},
    dsh: {
      ...manifest.dsh,
      profile: {
        ...manifest.dsh?.profile,
        bundles,
      },
    },
  };

  writeFileSync(manifestPath, `${JSON.stringify(nextManifest, undefined, 2)}\n`);
  console.info('[robbot:dsh-process] synced web profile bundles', {
    manifestPath,
    bundles,
    installedPluginPackages,
    enabledPluginPackages,
  });
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function stripPatchRowsById(patch: string, ids: string[]): string {
  if (ids.length === 0) {
    return patch;
  }

  const idsToStrip = new Set(ids);
  const lines = patch.split(/\r?\n/);
  const blocks: string[][] = [];
  let currentBlock: string[] = [];
  for (const line of lines) {
    if (/^-\s/.test(line)) {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock);
      }
      currentBlock = [line];
    } else {
      currentBlock.push(line);
    }
  }
  if (currentBlock.length > 0) {
    blocks.push(currentBlock);
  }

  return blocks
    .filter((block) => !hasPatchRowId(block, idsToStrip))
    .map((block) => block.join('\n').trimEnd())
    .join('\n');
}

function normalizePatchList(patch: string): string {
  const trimmed = patch.trim();
  return trimmed.includes('- ') ? `${patch.trimEnd()}\n` : '[]\n';
}

function hasPatchRowId(block: string[], ids: Set<string>): boolean {
  for (const line of block) {
    const match = line.match(/^\s*(?:-\s*)?(?:id|name):\s*(.+?)\s*$/);
    if (!match) {
      continue;
    }
    const value = unquoteYamlScalar(match[1]);
    if (ids.has(value)) {
      return true;
    }
  }
  return false;
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readWebProfileManifest(manifestPath: string): {
  name?: unknown;
  private?: unknown;
  dependencies?: unknown;
  dsh?: { profile?: { bundles?: unknown } };
} {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ReturnType<typeof readWebProfileManifest>;
    }
  } catch {
    // Missing or malformed profile manifests are recreated with Robbot's base Web profile.
  }
  return {};
}

function summarizeLaunchEnv(env: Record<string, string | undefined>): Record<string, unknown> {
  return {
    provider: env.ROBBOT_OPENAI_PROVIDER,
    openaiModel: env.ROBBOT_OPENAI_MODEL,
    deepseekModel: env.ROBBOT_DEEPSEEK_MODEL,
    dshModel: env.DSH_MODEL,
    permissionMode: env.DSH_PERMISSION_MODE,
    configPath: env.DSH_CORDIS_CONFIG,
    hasOpenaiApiKey: Boolean(env.OPENAI_API_KEY),
    hasOpenaiBaseUrl: Boolean(env.OPENAI_BASE_URL),
    hasDeepseekApiKey: Boolean(env.DEEPSEEK_API_KEY),
    hasDeepseekBaseUrl: Boolean(env.DEEPSEEK_BASE_URL),
    hasTsxTsconfigPath: Boolean(env.TSX_TSCONFIG_PATH),
  };
}

export function readRobbotEnvValueFromDshRoot(dshRoot: string, name: string): string | undefined {
  return readRobbotEnvFromDshRoot(dshRoot)[name];
}

function resolveNodeExecutable(): string {
  if (!isElectronRuntime() || !isPackagedDshRuntime()) {
    return process.execPath;
  }

  for (const candidate of [
    process.env.ROBBOT_NODE_EXECUTABLE,
    process.env.NODE_BINARY,
    packagedNodeExecutable(),
    resolveNodeFromPath(),
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
  ]) {
    if (candidate && isExecutableFile(candidate)) {
      return candidate;
    }
  }

  throw new HarnessError(
    'Unable to find a Node.js executable for starting DSH from Electron. Set ROBBOT_NODE_EXECUTABLE=/absolute/path/to/node.',
    'transport_error',
  );
}

function packagedNodeExecutable(): string | undefined {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (!resourcesPath) {
    return undefined;
  }

  return path.join(resourcesPath, 'bin', process.platform === 'win32' ? 'node.exe' : 'node');
}

function isPackagedDshRuntime(): boolean {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return Boolean(resourcesPath && existsSync(path.join(resourcesPath, 'dsh-runtime', 'lib', 'bin.js')));
}

function shouldRunElectronAsNode(nodeExecutable: string): boolean {
  return isElectronRuntime() && path.resolve(nodeExecutable) === path.resolve(process.execPath);
}

function resolveNodeFromPath(): string | undefined {
  const resolved = spawnSync('/usr/bin/env', ['node', '-p', 'process.execPath'], {
    encoding: 'utf8',
  });
  if (resolved.status !== 0) {
    return undefined;
  }

  return resolved.stdout.trim() || undefined;
}

function isExecutableFile(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isElectronRuntime(): boolean {
  return Boolean(process.versions.electron);
}

function isBuiltCliRuntime(cwd: string): boolean {
  try {
    accessSync(path.join(cwd, 'lib/bin.js'), constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function builtCliArgs(
  cwd: string,
  protocol: DshProcessProtocol,
  bin: string,
  configPath: string,
  envOverrides: Record<string, string | undefined>,
): string[] {
  const nodeFlags = shouldExposeInternalsForLocalBuiltRuntime(cwd) ? ['--expose-internals'] : [];
  if (protocol === 'web') {
    return [...nodeFlags, bin, 'web', '--host', '127.0.0.1', '--port', envPort(envOverrides), '--no-open'];
  }
  if (protocol === 'sdk') {
    return [...nodeFlags, bin, configPath];
  }
  return [...nodeFlags, bin, '--config', configPath];
}

function envPort(env: Record<string, string | undefined>): string {
  return env.ROBBOT_DSH_WEB_PORT ?? '3187';
}

function shouldExposeInternalsForLocalBuiltRuntime(cwd: string): boolean {
  const normalized = path.normalize(cwd);
  return normalized.endsWith(path.join('apps', 'desktop', '.runtime', 'dsh'));
}

function readRobbotEnvFromDshRoot(dshRoot: string): Record<string, string> {
  // Local-development fallback only. Do not treat .env as the product runtime
  // source of truth when Electron/SQLite account AI config is available.
  const envPath = path.resolve(dshRoot, '../..', '.env');
  let contents: string;
  try {
    contents = readFileSync(envPath, 'utf8');
  } catch {
    return {};
  }

  const env: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separator = line.indexOf('=');
    if (separator < 0) {
      continue;
    }

    const name = line.slice(0, separator).trim();
    const value = unquoteEnvValue(line.slice(separator + 1).trim());
    if (name && value.length > 0) {
      env[name] = value;
    }
  }

  return env;
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
