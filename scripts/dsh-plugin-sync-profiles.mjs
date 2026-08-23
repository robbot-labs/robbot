import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
const requestedPackageName = process.argv.slice(2).find((value) => !value.startsWith('--'));
const bestEffort = process.argv.includes('--best-effort');
const webPatchPath = path.join(repoRoot, 'config', 'dsh-web.cordis.patch.yml');
const runtimePluginsPackagePath = path.join(repoRoot, 'runtime-plugins', 'package.json');
const runtimePluginsManifestPath = path.join(repoRoot, 'runtime-plugins', 'manifest.json');
const runtimePluginNodeModules = path.join(repoRoot, 'runtime-plugins', 'node_modules');
const enabledPlugins = requestedPackageName === undefined
  ? readEnabledPlugins(runtimePluginsManifestPath)
  : [{ name: requestedPackageName, config: {} }];
const enabledPluginNames = enabledPlugins.map((plugin) => plugin.name);
const runtimePluginNames = uniqueStrings([
  ...runtimePluginPackageNames(runtimePluginsPackagePath),
  ...readRuntimePlugins(runtimePluginsManifestPath).map((plugin) => plugin.name),
]);
const unmanagedEnabledPluginNames = enabledPluginNames.filter((pluginName) => !runtimePluginNames.includes(pluginName));
const baseWebPatch = readFileSync(webPatchPath, 'utf8');

const selectedPluginNames = requestedPackageName === undefined
  ? enabledPluginNames
  : [requestedPackageName];

if (!existsSync(webPatchPath)) {
  throw new Error(`missing Web patch: ${path.relative(repoRoot, webPatchPath)}`);
}
if (!existsSync(runtimePluginsPackagePath)) {
  throw new Error(`missing runtime plugin package manifest: ${path.relative(repoRoot, runtimePluginsPackagePath)}`);
}
if (!existsSync(runtimePluginsManifestPath)) {
  throw new Error(`missing runtime plugin enablement manifest: ${path.relative(repoRoot, runtimePluginsManifestPath)}`);
}
if (enabledPluginNames.length === 0) {
  console.log('[robbot:dsh-plugin] no enabled runtime plugins');
}
if (unmanagedEnabledPluginNames.length > 0) {
  throw new Error(`enabled plugin(s) are missing from runtime-plugins/package.json: ${unmanagedEnabledPluginNames.join(', ')}`);
}
for (const pluginName of selectedPluginNames) {
  const packagePath = path.join(runtimePluginNodeModules, pluginName);
  if (!existsSync(packagePath)) {
    throw new Error(`missing runtime plugin package: ${path.relative(repoRoot, packagePath)}`);
  }
}

const targets = [
  {
    dshHome: path.join(repoRoot, 'apps', 'desktop', '.dsh-home'),
    linkPackages: false,
  },
  ...accountDshHomes('robbot').map((dshHome) => ({ dshHome, linkPackages: true })),
  ...accountDshHomes('Robbot').map((dshHome) => ({ dshHome, linkPackages: true })),
];

let changed = 0;
const failures = [];
for (const target of uniqueTargets(targets)) {
  const { dshHome } = target;
  if (!existsSync(dshHome)) continue;
  try {
    syncDshHome(target);
    console.log(`[robbot:dsh-plugin] synced ${pathLabel(dshHome)}`);
  } catch (error) {
    failures.push({ dshHome, error });
    console.error(`[robbot:dsh-plugin] failed ${pathLabel(dshHome)} - ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`[robbot:dsh-plugin] synced ${changed} profile update(s) for ${enabledPluginNames.join(', ') || 'no plugins'}`);
if (failures.length > 0 && !bestEffort) {
  process.exitCode = 1;
}

function accountDshHomes(productName) {
  const accountsRoot = path.join(os.homedir(), 'Library', 'Application Support', productName, 'dsh-home', 'accounts');
  if (!existsSync(accountsRoot)) return [];

  return readdirNames(accountsRoot)
    .map((name) => path.join(accountsRoot, name))
    .filter((candidate) => isDirectory(candidate));
}

function syncDshHome({ dshHome, linkPackages }) {
  const webProfileDir = path.join(dshHome, 'profiles', 'web');
  const manifestPath = path.join(webProfileDir, 'package.json');
  const profilePatchPath = path.join(webProfileDir, 'cordis.patch.yml');
  mkdirSync(webProfileDir, { recursive: true });

  const manifest = readManifest(manifestPath);
  const existingBundles = Array.isArray(manifest.dsh?.profile?.bundles)
    ? manifest.dsh.profile.bundles.filter((value) => typeof value === 'string')
    : ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'];
  const baseBundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'];
  const unmanagedBundles = uniqueStrings(existingBundles)
    .filter((value) => !baseBundles.includes(value))
    .filter((value) => !runtimePluginNames.includes(value));
  const bundles = uniqueStrings([...baseBundles, ...unmanagedBundles, ...enabledPluginNames]);

  writeJson(manifestPath, {
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
  });
  changed += 1;

  writeFileSync(profilePatchPath, webProfilePatch(baseWebPatch, runtimePluginNames, enabledPluginNames));
  changed += 1;

  if (linkPackages) {
    for (const pluginName of runtimePluginNames) {
      linkPackage(path.join(dshHome, 'profiles', 'node_modules', pluginName), path.join(runtimePluginNodeModules, pluginName));
    }
  }
}

function readEnabledPlugins(manifestPath) {
  return readRuntimePlugins(manifestPath).filter((plugin) => plugin.enabled);
}

function readRuntimePlugins(manifestPath) {
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const plugins = Array.isArray(parsed?.plugins) ? parsed.plugins : [];
  return plugins
    .filter((plugin) => plugin && typeof plugin === 'object' && typeof plugin.name === 'string')
    .map((plugin) => ({
      name: plugin.name,
      id: typeof plugin.id === 'string' ? plugin.id : plugin.name,
      enabled: plugin.enabled === true,
      config: plugin.config && typeof plugin.config === 'object' && !Array.isArray(plugin.config) ? plugin.config : {},
    }));
}

function runtimePluginPackageNames(manifestPath) {
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return [
    ...Object.keys(parsed.dependencies ?? {}),
    ...Object.keys(parsed.optionalDependencies ?? {}),
  ];
}

function readManifest(manifestPath) {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function webProfilePatch(basePatch, managedPluginNames, enabledPluginNames) {
  let patch = stripPatchRowsById(basePatch, managedPluginNames);
  if (enabledPluginNames.length === 0) {
    patch = stripPatchRowsById(patch, ['ui-sidebar']);
  }
  return normalizePatchList(patch);
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function stripPatchRowsById(patch, ids) {
  if (ids.length === 0) {
    return patch;
  }

  const idsToStrip = new Set(ids);
  const lines = patch.split(/\r?\n/);
  const blocks = [];
  let currentBlock = [];
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

function normalizePatchList(patch) {
  return patch.trim().includes('- ') ? `${patch.trimEnd()}\n` : '[]\n';
}

function hasPatchRowId(block, ids) {
  for (const line of block) {
    const match = line.match(/^\s*(?:-\s*)?(?:id|name):\s*(.+?)\s*$/);
    if (!match) continue;
    const value = unquoteYamlScalar(match[1]);
    if (ids.has(value)) {
      return true;
    }
  }
  return false;
}

function unquoteYamlScalar(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function linkPackage(linkPath, targetPath) {
  mkdirSync(path.dirname(linkPath), { recursive: true });

  try {
    const existing = lstatSync(linkPath);
    if (existing.isSymbolicLink()) {
      const currentTarget = path.resolve(path.dirname(linkPath), readlinkSync(linkPath));
      if (currentTarget === targetPath) return;
      unlinkSync(linkPath);
    } else {
      console.warn(`[robbot:dsh-plugin] skip existing non-symlink: ${linkPath}`);
      return;
    }
  } catch {
    // Missing link is created below.
  }

  symlinkSync(targetPath, linkPath, 'dir');
  changed += 1;
}

function readdirNames(dir) {
  return readdirSync(dir).filter((name) => typeof name === 'string');
}

function isDirectory(candidate) {
  try {
    return lstatSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function uniqueTargets(targets) {
  const byDshHome = new Map();
  for (const target of targets) {
    const existing = byDshHome.get(target.dshHome);
    byDshHome.set(target.dshHome, {
      dshHome: target.dshHome,
      linkPackages: Boolean(existing?.linkPackages || target.linkPackages),
    });
  }
  return [...byDshHome.values()];
}

function pathLabel(filePath) {
  return filePath.startsWith(repoRoot)
    ? path.relative(repoRoot, filePath)
    : filePath.replace(os.homedir(), '~');
}
