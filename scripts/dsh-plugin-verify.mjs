import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { formatRuntimePluginDiagnostics, resolveRuntimePluginPlan } from './lib/runtime-plugin-plan.mjs';

const repoRoot = process.cwd();

const anchors = {
  runtimePlugins: path.join(repoRoot, 'runtime-plugins', 'package.json'),
  runtimePluginsManifest: path.join(repoRoot, 'runtime-plugins', 'manifest.json'),
  packagedRuntime: path.join(repoRoot, 'apps', 'desktop', '.runtime', 'dsh', 'package.json'),
};
const packageName = process.argv[2] ?? firstManifestPluginName(anchors.runtimePluginsManifest);

let failed = false;

async function check(label, run) {
  try {
    const detail = await run();
    console.log(`PASS ${label}${detail ? ` - ${detail}` : ''}`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${label} - ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resolveFrom(anchor) {
  if (!existsSync(anchor)) {
    throw new Error(`missing anchor: ${path.relative(repoRoot, anchor)}`);
  }

  return createRequire(anchor).resolve(packageName);
}

function firstManifestPluginName(manifestPath) {
  if (!existsSync(manifestPath)) {
    throw new Error(`missing ${path.relative(repoRoot, manifestPath)}; pass a plugin package name explicitly`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const plugins = Array.isArray(manifest?.plugins) ? manifest.plugins : [];
  const firstPlugin = plugins.find((plugin) => typeof plugin?.name === 'string');
  if (!firstPlugin?.name) {
    throw new Error(`${path.relative(repoRoot, manifestPath)} does not declare any plugins; pass a plugin package name explicitly`);
  }
  return firstPlugin.name;
}

await check('Level 1 Resolve from runtime-plugins', () => path.relative(repoRoot, resolveFrom(anchors.runtimePlugins)));

await check('Level 2 Load plugin module', async () => {
  const resolved = resolveFrom(anchors.runtimePlugins);
  const module = await import(resolved);
  if (typeof module.apply !== 'function' && typeof module.default !== 'function') {
    throw new Error('module does not export apply() or a default plugin function');
  }
  return 'module exports a Cordis-style plugin entry';
});

await check('Level 2 Client bundle has no unmaterialized dynamic requires', () => {
  const pluginDir = packageRootFromResolved(resolveFrom(anchors.runtimePlugins));
  const manifest = JSON.parse(readFileSync(path.join(pluginDir, 'package.json'), 'utf8'));
  const clientEntry = manifest?.exports?.['./client'] ?? manifest?.dsh?.bundle?.client ?? './lib/client.js';
  if (typeof clientEntry !== 'string') {
    return 'no client entry declared';
  }
  const clientPath = path.join(pluginDir, clientEntry);
  if (!existsSync(clientPath)) {
    throw new Error(`${path.relative(repoRoot, clientPath)} is missing; rebuild ${packageName}`);
  }
  const clientBundle = readFileSync(clientPath, 'utf8');
  const dynamicRequires = [...clientBundle.matchAll(/\brequire\(["']([^"']+)["']\)/g)]
    .map((match) => match[1])
    .filter((moduleName) => !allowedClientExternal(moduleName));
  if (dynamicRequires.length > 0) {
    throw new Error(`${path.relative(repoRoot, clientPath)} leaks dynamic require(s): ${[...new Set(dynamicRequires)].join(', ')}`);
  }
  return path.relative(repoRoot, clientPath);
});

await check('Runtime plugin plan is valid', () => {
  const result = resolveRuntimePluginPlan({ repoRoot, strictWarnings: true });
  if (!result.ok) {
    throw new Error(formatRuntimePluginDiagnostics(result.diagnostics));
  }
  return `${result.plan.enabledPluginNames.length} enabled plugin(s), ${result.diagnostics.length} warning(s)`;
});

await check('Plugin manifest entry is declared', () => {
  if (!existsSync(anchors.runtimePluginsManifest)) {
    throw new Error(`missing ${path.relative(repoRoot, anchors.runtimePluginsManifest)}`);
  }

  const manifest = JSON.parse(readFileSync(anchors.runtimePluginsManifest, 'utf8'));
  const plugins = Array.isArray(manifest?.plugins) ? manifest.plugins : [];
  const entry = plugins.find((plugin) => plugin?.name === packageName);
  if (!entry) {
    throw new Error(`${path.relative(repoRoot, anchors.runtimePluginsManifest)} does not include ${packageName}`);
  }
  return entry.enabled === true ? 'enabled' : 'disabled';
});

await check('Level 3 Web profile follows plugin manifest', () => {
  const manifestPath = path.join(repoRoot, 'apps', 'desktop', '.dsh-home', 'profiles', 'web', 'package.json');
  const patchPath = path.join(repoRoot, 'apps', 'desktop', '.dsh-home', 'profiles', 'web', 'cordis.patch.yml');
  if (!existsSync(manifestPath)) {
    return 'profile manifest will be created on next Web startup';
  }

  const runtimeManifest = JSON.parse(readFileSync(anchors.runtimePluginsManifest, 'utf8'));
  const plugins = Array.isArray(runtimeManifest?.plugins) ? runtimeManifest.plugins : [];
  const enabled = plugins.some((plugin) => plugin?.name === packageName && plugin.enabled === true);
  const hasEnabledRuntimePlugin = plugins.some((plugin) => plugin?.enabled === true);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const bundles = manifest?.dsh?.profile?.bundles;
  if (enabled && (!Array.isArray(bundles) || !bundles.includes(packageName))) {
    throw new Error(`${path.relative(repoRoot, manifestPath)} does not include ${packageName}; run pnpm dsh:plugin:sync-profiles or restart Robbot Web`);
  }
  if (!enabled && Array.isArray(bundles) && bundles.includes(packageName)) {
    throw new Error(`${path.relative(repoRoot, manifestPath)} still includes disabled ${packageName}; run pnpm dsh:plugin:sync-profiles or restart Robbot Web`);
  }
  if (existsSync(patchPath)) {
    const patch = readFileSync(patchPath, 'utf8');
    const patchBody = patch
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .join('\n');
    if (patchBody !== '[]' && !patchBody.startsWith('- ')) {
      throw new Error(`${path.relative(repoRoot, patchPath)} must be a top-level YAML array; use [] when there are no patch rows`);
    }
    if (patch.includes(packageName)) {
      throw new Error(`${path.relative(repoRoot, patchPath)} should not configure ${packageName}; DSH profile bundles load plugins and duplicate patch rows fail packaged startup`);
    }
    if (!hasEnabledRuntimePlugin && patch.includes('ui-sidebar')) {
      throw new Error(`${path.relative(repoRoot, patchPath)} disables ui-sidebar while no runtime plugins are enabled; DSH Web needs its base sidebar in this state`);
    }
  }
  return `${path.relative(repoRoot, manifestPath)}${existsSync(patchPath) ? `, ${path.relative(repoRoot, patchPath)}` : ''}`;
});

await check('Level 5 Package resolve from built runtime', () => {
  if (!existsSync(anchors.packagedRuntime)) {
    throw new Error('packaged runtime is missing; run the desktop DSH runtime build first');
  }
  return path.relative(repoRoot, resolveFrom(anchors.packagedRuntime));
});

await check('Level 5 Package manifest is materialized', () => {
  const sourceManifestPath = anchors.runtimePluginsManifest;
  const packagedManifestPath = path.join(repoRoot, 'apps', 'desktop', '.runtime', 'dsh', 'manifest.json');
  if (!existsSync(packagedManifestPath)) {
    throw new Error(`${path.relative(repoRoot, packagedManifestPath)} is missing; rebuild the desktop DSH runtime`);
  }
  const sourceManifest = readFileSync(sourceManifestPath, 'utf8');
  const packagedManifest = readFileSync(packagedManifestPath, 'utf8');
  if (sourceManifest !== packagedManifest) {
    throw new Error(`${path.relative(repoRoot, packagedManifestPath)} is stale; rebuild the desktop DSH runtime`);
  }
  return path.relative(repoRoot, packagedManifestPath);
});

await check('Level 5 Packaged client bundle has no unmaterialized dynamic requires', () => {
  if (!existsSync(anchors.packagedRuntime)) {
    throw new Error('packaged runtime is missing; run the desktop DSH runtime build first');
  }
  const pluginDir = packageRootFromResolved(resolveFrom(anchors.packagedRuntime));
  const manifest = JSON.parse(readFileSync(path.join(pluginDir, 'package.json'), 'utf8'));
  const clientEntry = manifest?.exports?.['./client'] ?? manifest?.dsh?.bundle?.client ?? './lib/client.js';
  if (typeof clientEntry !== 'string') {
    return 'no client entry declared';
  }
  const clientPath = path.join(pluginDir, clientEntry);
  if (!existsSync(clientPath)) {
    throw new Error(`${path.relative(repoRoot, clientPath)} is missing; rebuild the desktop DSH runtime`);
  }
  const clientBundle = readFileSync(clientPath, 'utf8');
  const dynamicRequires = [...clientBundle.matchAll(/\brequire\(["']([^"']+)["']\)/g)]
    .map((match) => match[1])
    .filter((moduleName) => !allowedClientExternal(moduleName));
  if (dynamicRequires.length > 0) {
    throw new Error(`${path.relative(repoRoot, clientPath)} leaks dynamic require(s): ${[...new Set(dynamicRequires)].join(', ')}`);
  }
  return path.relative(repoRoot, clientPath);
});

function allowedClientExternal(moduleName) {
  return moduleName === 'react'
    || moduleName === 'react/jsx-runtime'
    || moduleName === 'react-dom'
    || moduleName === 'react-dom/client'
    || moduleName === '@deepseek-ai/cordis'
    || moduleName.startsWith('@deepseek-ai/dsh-client-')
    || moduleName.startsWith('@deepseek-ai/dsh-api-remotes');
}

function packageRootFromResolved(resolvedPath) {
  let current = path.dirname(resolvedPath);
  while (current !== path.dirname(current)) {
    if (existsSync(path.join(current, 'package.json'))) {
      return current;
    }
    current = path.dirname(current);
  }
  throw new Error(`unable to find package root for ${path.relative(repoRoot, resolvedPath)}`);
}

console.log('NEXT Level 4 Execute requires starting Robbot/DSH and invoking the plugin tool once.');

if (failed) {
  process.exit(1);
}
