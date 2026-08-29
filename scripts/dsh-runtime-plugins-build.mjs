import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const runtimePluginsRoot = path.join(repoRoot, 'runtime-plugins');
const runtimePluginsManifestPath = path.join(runtimePluginsRoot, 'package.json');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const corepackHome = path.join(repoRoot, '.cache', 'corepack');

function readPackageJson(packageDir) {
  return JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
}

function run(command, args, options = {}) {
  const label = [command, ...args].join(' ');
  console.log(`[robbot:dsh-runtime-plugin] ${label}${options.cwd ? ` (${path.relative(repoRoot, options.cwd)})` : ''}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, CI: 'true', COREPACK_HOME: corepackHome },
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit ${String(result.status)}`);
  }
}

function localRuntimePluginDirectories() {
  if (!fs.existsSync(runtimePluginsManifestPath)) {
    return [];
  }

  const manifest = readPackageJson(runtimePluginsRoot);
  const dependencies = {
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  };

  return Object.entries(dependencies)
    .map(([packageName, spec]) => {
      if (typeof spec !== 'string') {
        return undefined;
      }
      const prefix = ['link:', 'file:'].find(value => spec.startsWith(value));
      if (!prefix) {
        return undefined;
      }

      const packageDir = path.resolve(runtimePluginsRoot, spec.slice(prefix.length));
      const packageJsonPath = path.join(packageDir, 'package.json');
      if (!fs.existsSync(packageJsonPath)) {
        throw new Error(`Missing runtime plugin submodule for ${packageName}: ${path.relative(repoRoot, packageDir)}`);
      }

      return { packageName, packageDir };
    })
    .filter(Boolean);
}

function installPackage(packageDir) {
  const lockfilePath = path.join(packageDir, 'pnpm-lock.yaml');
  run(pnpmCommand, fs.existsSync(lockfilePath) ? ['install', '--frozen-lockfile'] : ['install'], { cwd: packageDir });
}

if (!fs.existsSync(runtimePluginsManifestPath)) {
  console.log('[robbot:dsh-runtime-plugin] no runtime-plugins/package.json found');
  process.exit(0);
}

installPackage(runtimePluginsRoot);

const pluginDirectories = localRuntimePluginDirectories();
if (pluginDirectories.length === 0) {
  console.log('[robbot:dsh-runtime-plugin] no local runtime plugins to build');
  process.exit(0);
}

for (const { packageName, packageDir } of pluginDirectories) {
  installPackage(packageDir);
  const manifest = readPackageJson(packageDir);
  if (typeof manifest.scripts?.build !== 'string') {
    console.log(`[robbot:dsh-runtime-plugin] ${packageName} has no build script`);
    continue;
  }

  run(pnpmCommand, ['run', 'build'], { cwd: packageDir });
}
