import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(appDir, '../..');
const dshRoot = path.join(repoRoot, 'vendor', 'deepseek-harness');
const runtimePluginsRoot = path.join(repoRoot, 'runtime-plugins');
const outputDir = path.resolve(process.argv[2] ?? path.join(appDir, '.runtime', 'dsh'));
const runtimeLayoutVersion = 4;
const currentNativeTag = `${process.platform}-${process.arch}`;

function exists(relativePath) {
  return fs.existsSync(path.join(dshRoot, relativePath));
}

function assertDshBuildReady() {
  const missing = [
    'package.json',
    'apps/cli/lib/bin.js',
    'apps/web/dist',
  ].filter(relativePath => !exists(relativePath));

  if (missing.length > 0) {
    throw new Error(
      [
        `DSH runtime is not built. Missing: ${missing.join(', ')}.`,
        'Run from repo root: pnpm dsh:setup',
        'Then package Windows from apps/desktop: npm run make:win',
      ].join('\n'),
    );
  }
}

function packageParts(packageName) {
  return packageName.split('/');
}

function packageManifest(packageDir) {
  return JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
}

function fieldReferencesSrc(value) {
  if (typeof value === 'string') {
    return value.split('/').includes('src');
  }

  if (Array.isArray(value)) {
    return value.some(fieldReferencesSrc);
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, childValue]) => (
      key !== 'types'
      && key !== 'typings'
      && fieldReferencesSrc(childValue)
    ));
  }

  return false;
}

function collectRuntimeEntryFiles(value, entries = new Set()) {
  if (typeof value === 'string') {
    entries.add(value);
    return entries;
  }

  if (Array.isArray(value)) {
    for (const childValue of value) {
      collectRuntimeEntryFiles(childValue, entries);
    }
    return entries;
  }

  if (value && typeof value === 'object') {
    for (const [key, childValue] of Object.entries(value)) {
      if (key !== 'types' && key !== 'typings') {
        collectRuntimeEntryFiles(childValue, entries);
      }
    }
  }

  return entries;
}

function runtimeEntryFiles(manifest) {
  return new Set([
    ...collectRuntimeEntryFiles(manifest.main),
    ...collectRuntimeEntryFiles(manifest.module),
    ...collectRuntimeEntryFiles(manifest.exports),
    ...collectRuntimeEntryFiles(manifest.bin),
  ]);
}

function entryFilesReferenceSrc(packageDir, manifest) {
  for (const entry of runtimeEntryFiles(manifest)) {
    if (entry.split('/').includes('src')) {
      return true;
    }

    const entryPath = path.join(packageDir, entry);
    if (fs.existsSync(entryPath) && fs.statSync(entryPath).isFile()) {
      const text = fs.readFileSync(entryPath, 'utf8');
      if (text.includes('/src/') || text.includes('./src/') || text.includes('"src/') || text.includes("'src/")) {
        return true;
      }
    }
  }

  return false;
}

function missingRuntimeEntryFiles(packageDir, manifest) {
  return [...runtimeEntryFiles(manifest)]
    .filter((entry) => entry !== './package.json' && entry !== 'package.json')
    .filter((entry) => !fs.existsSync(path.join(packageDir, entry)));
}

function ensurePackageRuntimeBuilt(packageDir, manifest, packageName) {
  const missingEntries = missingRuntimeEntryFiles(packageDir, manifest);
  if (missingEntries.length === 0) {
    return;
  }
  if (typeof manifest.scripts?.build !== 'string') {
    return;
  }

  ensureBuildNodeModules(packageDir);
  console.log(`[robbot:dsh-runtime] building ${packageName}; missing runtime entries: ${missingEntries.join(', ')}`);
  const result = spawnSync('npm', ['run', 'build'], {
    cwd: packageDir,
    env: {
      ...process.env,
      PATH: [
        path.join(packageDir, 'node_modules', '.bin'),
        path.join(dshRoot, 'node_modules', '.bin'),
        process.env.PATH,
      ].filter(Boolean).join(path.delimiter),
    },
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`npm run build failed for ${packageName} with exit ${String(result.status)}`);
  }

  const stillMissing = missingRuntimeEntryFiles(packageDir, manifest);
  if (stillMissing.length > 0) {
    throw new Error(`build for ${packageName} did not create runtime entries: ${stillMissing.join(', ')}`);
  }
}

function ensureBuildNodeModules(packageDir) {
  const nodeModulesPath = path.join(packageDir, 'node_modules');
  const hoistedNodeModules = path.join(dshRoot, 'node_modules', '.pnpm', 'node_modules');
  if (!fs.existsSync(hoistedNodeModules)) {
    return;
  }

  if (fs.existsSync(nodeModulesPath)) {
    const stat = fs.lstatSync(nodeModulesPath);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(nodeModulesPath);
    } else if (!stat.isDirectory()) {
      return;
    }
  }

  fs.mkdirSync(nodeModulesPath, { recursive: true });
  linkBuildDependency(nodeModulesPath, dshRoot, 'tsdown');
  linkBuildDependency(nodeModulesPath, dshRoot, 'typescript');
  const manifest = packageManifest(packageDir);
  for (const packageName of Object.keys({
    ...manifest.dependencies,
    ...manifest.peerDependencies,
  })) {
    linkBuildDependency(nodeModulesPath, hoistedNodeModules, packageName);
  }
}

function linkBuildDependency(nodeModulesPath, sourceNodeModulesPath, packageName) {
  const sourcePath = path.join(sourceNodeModulesPath, ...packageParts(packageName));
  if (!fs.existsSync(sourcePath)) {
    return;
  }

  const linkPath = path.join(nodeModulesPath, ...packageParts(packageName));
  if (fs.existsSync(linkPath)) {
    return;
  }

  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(path.relative(path.dirname(linkPath), sourcePath), linkPath, 'dir');
}

function packageUsesSrcAtRuntime(packageDir, manifest) {
  return fieldReferencesSrc(manifest.main)
    || fieldReferencesSrc(manifest.module)
    || fieldReferencesSrc(manifest.exports)
    || fieldReferencesSrc(manifest.bin)
    || entryFilesReferenceSrc(packageDir, manifest);
}

function packageMatchesCurrentPlatform(packageName) {
  if (process.platform === 'darwin') {
    if (packageName.includes('win32') || packageName.includes('windows') || packageName.includes('linux')) {
      return false;
    }
    if (packageName.includes('darwin-x64') && process.arch !== 'x64') {
      return false;
    }
    if (packageName.includes('darwin-arm64') && process.arch !== 'arm64') {
      return false;
    }
  }

  if (process.platform === 'linux') {
    if (packageName.includes('win32') || packageName.includes('windows') || packageName.includes('darwin')) {
      return false;
    }
  }

  if (process.platform === 'win32') {
    if (packageName.includes('darwin') || packageName.includes('linux')) {
      return false;
    }
  }

  return true;
}

function packageDirectoryExists(packageDir) {
  return fs.existsSync(path.join(packageDir, 'package.json'));
}

function localRuntimePluginPackageDirectory(packageName) {
  const manifestPath = path.join(runtimePluginsRoot, 'package.json');
  if (!fs.existsSync(manifestPath)) {
    return undefined;
  }

  const manifest = packageManifest(runtimePluginsRoot);
  const spec = {
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  }[packageName];

  if (typeof spec !== 'string') {
    return undefined;
  }

  const localPrefixes = ['link:', 'file:'];
  const prefix = localPrefixes.find(value => spec.startsWith(value));
  if (!prefix) {
    return undefined;
  }

  const packageDir = path.resolve(runtimePluginsRoot, spec.slice(prefix.length));
  if (!packageDirectoryExists(packageDir)) {
    throw new Error(`Unable to resolve local DSH runtime plugin ${packageName} from ${spec}`);
  }

  return fs.realpathSync(packageDir);
}

function resolvePackageDirectory(packageName) {
  const localRuntimePluginPackageDir = localRuntimePluginPackageDirectory(packageName);
  if (localRuntimePluginPackageDir) {
    return localRuntimePluginPackageDir;
  }

  for (const nodeModulesRoot of runtimeNodeModulesRoots()) {
    const directPath = path.join(nodeModulesRoot, ...packageParts(packageName));
    if (packageDirectoryExists(directPath)) {
      return fs.realpathSync(directPath);
    }

    const workspacePath = path.join(nodeModulesRoot, '.pnpm', 'node_modules', ...packageParts(packageName));
    if (packageDirectoryExists(workspacePath)) {
      return fs.realpathSync(workspacePath);
    }
  }

  for (const nodeModulesRoot of runtimeNodeModulesRoots()) {
    const virtualStore = path.join(nodeModulesRoot, '.pnpm');
    if (!fs.existsSync(virtualStore)) {
      continue;
    }

    const suffix = path.join('node_modules', ...packageParts(packageName));
    for (const entry of fs.readdirSync(virtualStore)) {
      const candidate = path.join(virtualStore, entry, suffix);
      if (packageDirectoryExists(candidate)) {
        return fs.realpathSync(candidate);
      }
    }
  }

  throw new Error(`Unable to resolve DSH runtime dependency: ${packageName}`);
}

function runtimeNodeModulesRoots() {
  return [
    path.join(dshRoot, 'node_modules'),
    path.join(runtimePluginsRoot, 'node_modules'),
  ].filter(directory => fs.existsSync(directory));
}

function copyPackageDirectory(sourcePath, targetPath, options = {}) {
  const sourceRealPath = fs.realpathSync(sourcePath);
  const keepSrc = options.keepSrc === true;
  fs.rmSync(targetPath, { force: true, recursive: true });
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.cpSync(sourceRealPath, targetPath, {
    dereference: true,
    recursive: true,
    filter(source) {
      if (source === sourceRealPath) {
        return true;
      }

      const parts = path.relative(sourceRealPath, source).split(path.sep);
      return !parts.some(part => [
        '.git',
        '.github',
        '.cache',
        '.turbo',
        'coverage',
        'docs',
        'examples',
        'node_modules',
        'sample',
        'samples',
        'test',
        'tests',
        '__tests__',
      ].includes(part) || (!keepSrc && part === 'src'))
        && !source.endsWith('.map')
        && !source.endsWith('.d.ts')
        && !source.endsWith('.tsbuildinfo');
    },
  });
}

function materializePackage(packageName, seen = new Set(), options = {}) {
  if (seen.has(packageName)) {
    return;
  }
  seen.add(packageName);

  const sourcePath = resolvePackageDirectory(packageName);
  const targetPath = path.join(outputDir, 'node_modules', ...packageParts(packageName));
  const manifest = packageManifest(sourcePath);
  if (options.buildMissingRuntimeEntries === true) {
    ensurePackageRuntimeBuilt(sourcePath, manifest, packageName);
  }
  copyPackageDirectory(sourcePath, targetPath, { keepSrc: packageUsesSrcAtRuntime(sourcePath, manifest) });

  const dependencies = {
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  };
  for (const childPackageName of Object.keys(dependencies)) {
    if (manifest.optionalDependencies?.[childPackageName] && !packageMatchesCurrentPlatform(childPackageName)) {
      continue;
    }

    try {
      materializePackage(childPackageName, seen);
    } catch (error) {
      if (!manifest.optionalDependencies?.[childPackageName] && !manifest.peerDependencies?.[childPackageName]) {
        throw error;
      }
    }
  }
}

function buildFlatRuntime() {
  fs.rmSync(outputDir, { force: true, recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const cliPath = path.join(dshRoot, 'apps', 'cli');
  const cliManifest = packageManifest(cliPath);
  fs.writeFileSync(path.join(outputDir, 'package.json'), `${JSON.stringify(cliManifest, null, 2)}\n`);
  copyPackageDirectory(cliPath, outputDir, { keepSrc: packageUsesSrcAtRuntime(cliPath, cliManifest) });
  copyRuntimePluginManifest();
  copyRuntimePluginResolver();

  const seen = new Set();
  for (const packageName of Object.keys({
    ...cliManifest.dependencies,
    ...cliManifest.optionalDependencies,
    ...cliManifest.peerDependencies,
  })) {
    if (cliManifest.optionalDependencies?.[packageName] && !packageMatchesCurrentPlatform(packageName)) {
      continue;
    }

    try {
      materializePackage(packageName, seen);
    } catch (error) {
      if (!cliManifest.optionalDependencies?.[packageName] && !cliManifest.peerDependencies?.[packageName]) {
        throw error;
      }
    }
  }

  for (const packageName of runtimePluginPackageNames()) {
    materializePackage(packageName, seen, { buildMissingRuntimeEntries: true });
  }
  console.log(`[robbot:dsh-runtime] materialized ${seen.size} packages into a flat runtime node_modules`);
}

function copyRuntimePluginManifest() {
  const manifestPath = path.join(runtimePluginsRoot, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return;
  }

  fs.copyFileSync(manifestPath, path.join(outputDir, 'manifest.json'));
}

function copyRuntimePluginResolver() {
  const resolverPath = path.join(repoRoot, 'scripts', 'lib', 'runtime-plugin-plan.mjs');
  if (!fs.existsSync(resolverPath)) {
    throw new Error(`missing runtime plugin resolver: ${resolverPath}`);
  }

  const targetPath = path.join(outputDir, 'scripts', 'lib', 'runtime-plugin-plan.mjs');
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(resolverPath, targetPath);
}

function runtimePluginPackageNames() {
  const manifestPath = path.join(runtimePluginsRoot, 'package.json');
  if (!fs.existsSync(manifestPath)) {
    return [];
  }

  const manifest = packageManifest(runtimePluginsRoot);
  return Object.keys({
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  });
}

function removePathIfExists(relativePath) {
  const absolutePath = path.join(outputDir, relativePath);
  if (fs.existsSync(absolutePath)) {
    fs.rmSync(absolutePath, { force: true, recursive: true });
  }
}

function prunePlatformSpecificRuntime() {
  const nodePtyPrebuilds = path.join(outputDir, 'node_modules', 'node-pty', 'prebuilds');
  if (fs.existsSync(nodePtyPrebuilds)) {
    for (const entry of fs.readdirSync(nodePtyPrebuilds, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== currentNativeTag) {
        fs.rmSync(path.join(nodePtyPrebuilds, entry.name), { force: true, recursive: true });
      }
    }
  }

  if (process.platform !== 'linux') {
    removePathIfExists('node_modules/@deepseek-ai/node-addon-landlock-run-linux-arm64');
    removePathIfExists('node_modules/@deepseek-ai/node-addon-landlock-run-linux-x64');
  }
}

function removeGeneratedNoise(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === '.github' || entry.name === '.cache') {
        fs.rmSync(absolutePath, { force: true, recursive: true });
        continue;
      }
      removeGeneratedNoise(absolutePath);
      continue;
    }

    if (
      entry.name.endsWith('.map')
      || entry.name.endsWith('.d.ts')
      || entry.name.endsWith('.tsbuildinfo')
      || entry.name.endsWith('.pdb')
      || entry.name === 'README.i18n.yaml'
      || (entry.name.endsWith('.md') && !entry.name.toLowerCase().startsWith('license'))
    ) {
      fs.rmSync(absolutePath, { force: true });
    }
  }
}

function writeRuntimeMarker() {
  fs.writeFileSync(
    path.join(outputDir, 'robbot-runtime.json'),
    `${JSON.stringify({
      kind: 'robbot-dsh-runtime',
      package: '@deepseek-ai/dsh',
      layoutVersion: runtimeLayoutVersion,
      generatedAt: new Date().toISOString(),
    }, null, 2)}\n`,
  );
}

assertDshBuildReady();
buildFlatRuntime();
prunePlatformSpecificRuntime();
removeGeneratedNoise(outputDir);
writeRuntimeMarker();
