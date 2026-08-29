const path = require('node:path');
const fsSync = require('node:fs');
const { spawnSync } = require('node:child_process');
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const electronVersion = require('./package.json').devDependencies.electron.replace(/^[^\d]*/, '');
let preparedDshRuntimeBundle;
let preparedNodeExecutable;
const createdElectronPackageLinks = new Set();

function packagePathParts(packageName) {
  return packageName.split('/');
}

function packageDirExists(packageDir) {
  return fsSync.existsSync(path.join(packageDir, 'package.json'));
}

function findPnpmPackageDir(packageName, rootDir) {
  const virtualStore = path.join(rootDir, 'node_modules', '.pnpm');

  if (!fsSync.existsSync(virtualStore)) {
    return undefined;
  }

  const packageSuffix = path.join('node_modules', ...packagePathParts(packageName));

  for (const entry of fsSync.readdirSync(virtualStore)) {
    const packageDir = path.join(virtualStore, entry, packageSuffix);

    if (packageDirExists(packageDir)) {
      return packageDir;
    }
  }

  return undefined;
}

function resolvePackageDir(packageName) {
  const repoRoot = path.resolve(__dirname, '../..');
  const searchPaths = [repoRoot, __dirname];

  for (const searchPath of searchPaths) {
    const directPackageDir = path.join(searchPath, 'node_modules', ...packagePathParts(packageName));

    if (packageDirExists(directPackageDir)) {
      return directPackageDir;
    }

    const pnpmPackageDir = findPnpmPackageDir(packageName, searchPath);

    if (pnpmPackageDir) {
      return pnpmPackageDir;
    }
  }

  throw new Error(`Could not locate package root for ${packageName}`);
}

function copyPackageDirectory(sourcePath, targetPath) {
  const realSourcePath = fsSync.realpathSync(sourcePath);

  fsSync.rmSync(targetPath, { force: true, recursive: true });
  fsSync.mkdirSync(path.dirname(targetPath), { recursive: true });
  fsSync.cpSync(realSourcePath, targetPath, {
    recursive: true,
    verbatimSymlinks: true,
    filter(source) {
      return source === realSourcePath || !path.relative(realSourcePath, source).split(path.sep).includes('node_modules');
    },
  });
}

function ensurePackageCopy(packageName, targetPath) {
  copyPackageDirectory(resolvePackageDir(packageName), targetPath);
}

function ensureWorkspacePackageCopy(packageName, packageDir) {
  copyPackageDirectory(packageDir, path.join(__dirname, 'node_modules', ...packagePathParts(packageName)));
}

function readPackageJson(packageDir) {
  return JSON.parse(fsSync.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
}

function materializePackage(packageName, seen = new Set()) {
  if (seen.has(packageName)) {
    return;
  }

  seen.add(packageName);

  const packageDir =
    packageName === '@robbot/core'
      ? path.resolve(__dirname, '../../packages/core')
      : packageName === '@robbot/dsh-adapter'
        ? path.resolve(__dirname, '../../packages/dsh-adapter')
        : resolvePackageDir(packageName);
  const targetPath = path.join(__dirname, 'node_modules', ...packagePathParts(packageName));

  copyPackageDirectory(packageDir, targetPath);

  const packageJson = readPackageJson(packageDir);
  const childDependencies = {
    ...packageJson.dependencies,
    ...packageJson.optionalDependencies,
  };

  for (const childPackageName of Object.keys(childDependencies)) {
    try {
      materializePackage(childPackageName, seen);
    } catch (error) {
      if (!packageJson.optionalDependencies?.[childPackageName]) {
        throw error;
      }
    }
  }
}

function materializeRuntimeDependencies() {
  const packageJson = readPackageJson(__dirname);

  for (const packageName of Object.keys(packageJson.dependencies ?? {})) {
    materializePackage(packageName);
  }
}

function ensurePackageLink(packageName, seen = new Set()) {
  if (seen.has(packageName)) {
    return;
  }

  seen.add(packageName);
  const targetPath = path.join(__dirname, 'node_modules', ...packagePathParts(packageName));

  if (!packageDirExists(targetPath)) {
    const sourcePath = resolvePackageDir(packageName);
    fsSync.mkdirSync(path.dirname(targetPath), { recursive: true });
    fsSync.symlinkSync(sourcePath, targetPath, process.platform === 'win32' ? 'junction' : 'dir');
    createdElectronPackageLinks.add(targetPath);
    console.log(`[robbot:package] linked ${packageName} for Forge at ${targetPath}`);
  }

  const packageJson = readPackageJson(targetPath);
  const childDependencies = {
    ...packageJson.dependencies,
    ...packageJson.optionalDependencies,
  };

  for (const childPackageName of Object.keys(childDependencies)) {
    try {
      ensurePackageLink(childPackageName, seen);
    } catch (error) {
      if (!packageJson.optionalDependencies?.[childPackageName]) {
        throw error;
      }
    }
  }
}

function ensureElectronPackageLinks() {
  if (createdElectronPackageLinks.size === 0) {
    process.once('exit', cleanupElectronPackageLinks);
  }

  ensurePackageLink('electron');
}

function cleanupElectronPackageLinks() {
  if (createdElectronPackageLinks.size === 0) {
    return;
  }

  for (const targetPath of [...createdElectronPackageLinks].reverse()) {
    try {
      fsSync.rmSync(targetPath, {
        force: true,
        maxRetries: process.platform === 'win32' ? 3 : 0,
        recursive: true,
        retryDelay: 100,
      });
    } catch (error) {
      console.warn(`[robbot:package] unable to remove temporary package link ${targetPath}: ${error.message}`);
    }
  }

  createdElectronPackageLinks.clear();
  console.log('[robbot:package] removed temporary Electron package links');
}

function prepareElectronWinstallerVendor() {
  const vendorPath = path.join(resolvePackageDir('electron-winstaller'), 'vendor');
  const arch = process.arch;

  for (const extension of ['exe', 'dll']) {
    const sourcePath = path.join(vendorPath, `7z-${arch}.${extension}`);
    const targetPath = path.join(vendorPath, `7z.${extension}`);

    if (fsSync.existsSync(sourcePath)) {
      fsSync.copyFileSync(sourcePath, targetPath);
    }
  }
}

function copyDirectory(sourcePath, targetPath, options = {}) {
  const realSourcePath = fsSync.realpathSync(sourcePath);
  const excludeNames = new Set(options.excludeNames ?? []);

  fsSync.rmSync(targetPath, { force: true, recursive: true });
  fsSync.mkdirSync(path.dirname(targetPath), { recursive: true });
  fsSync.cpSync(realSourcePath, targetPath, {
    dereference: options.dereference === true,
    recursive: true,
    verbatimSymlinks: options.verbatimSymlinks === true,
    filter(source) {
      if (source === realSourcePath) {
        return true;
      }

      return !path.relative(realSourcePath, source).split(path.sep).some(part => excludeNames.has(part));
    },
  });
}

function directorySizeBytes(targetPath) {
  if (!fsSync.existsSync(targetPath)) {
    return 0;
  }

  const stat = fsSync.lstatSync(targetPath);
  if (!stat.isDirectory()) {
    return stat.size;
  }

  let size = 0;
  for (const entry of fsSync.readdirSync(targetPath)) {
    size += directorySizeBytes(path.join(targetPath, entry));
  }
  return size;
}

function formatBytes(bytes) {
  const units = ['B', 'K', 'M', 'G'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)}${units[unitIndex]}`;
}

function logPackageSizeAudit(resourceDir) {
  const appDir = process.platform === 'darwin'
    ? path.resolve(resourceDir, '..', '..')
    : path.resolve(resourceDir, '..');
  const entries = [
    ['app', appDir],
    ['Frameworks', process.platform === 'darwin' ? path.join(appDir, 'Contents', 'Frameworks') : undefined],
    ['Resources', resourceDir],
    ['dsh-runtime', path.join(resourceDir, 'dsh-runtime')],
    ['bin/node', path.join(resourceDir, 'bin', process.platform === 'win32' ? 'node.exe' : 'node')],
    ['app.asar', path.join(resourceDir, 'app.asar')],
    ['app.asar.unpacked', path.join(resourceDir, 'app.asar.unpacked')],
  ];

  console.log('[robbot:size] packaged app size audit');
  for (const [label, targetPath] of entries) {
    if (targetPath && fsSync.existsSync(targetPath)) {
      console.log(`[robbot:size] ${label}: ${formatBytes(directorySizeBytes(targetPath))}`);
    }
  }
}

function logArtifactSizeAudit(makeResults = []) {
  const artifacts = makeResults.flatMap(result => result.artifacts ?? []);
  if (artifacts.length === 0) {
    return;
  }

  console.log('[robbot:size] make artifact size audit');
  for (const artifactPath of artifacts) {
    if (fsSync.existsSync(artifactPath)) {
      console.log(`[robbot:size] ${path.basename(artifactPath)}: ${formatBytes(directorySizeBytes(artifactPath))}`);
    }
  }
}

function materializeExternalSymlinks(rootPath) {
  let changed = true;

  while (changed) {
    changed = false;
    const pending = [];

    function collect(currentPath) {
      for (const entry of fsSync.readdirSync(currentPath, { withFileTypes: true })) {
        const absolutePath = path.join(currentPath, entry.name);
        if (entry.isSymbolicLink()) {
          const realPath = fsSync.realpathSync(absolutePath);
          if (!realPath.startsWith(`${rootPath}${path.sep}`)) {
            pending.push({ absolutePath, realPath });
          }
          continue;
        }
        if (entry.isDirectory()) {
          collect(absolutePath);
        }
      }
    }

    collect(rootPath);
    for (const { absolutePath, realPath } of pending) {
      fsSync.rmSync(absolutePath, { force: true, recursive: true });
      fsSync.mkdirSync(path.dirname(absolutePath), { recursive: true });
      const stat = fsSync.statSync(realPath);
      if (stat.isDirectory()) {
        fsSync.cpSync(realPath, absolutePath, {
          recursive: true,
          verbatimSymlinks: true,
        });
      } else {
        fsSync.copyFileSync(realPath, absolutePath);
      }
      changed = true;
    }
  }
}

function resourceDirsForPackageOutput(outputPath) {
  if (process.platform === 'darwin') {
    const appPaths = outputPath.endsWith('.app')
      ? [outputPath]
      : fsSync.readdirSync(outputPath)
          .filter(entry => entry.endsWith('.app'))
          .map(entry => path.join(outputPath, entry));

    return appPaths.map(appPath => path.join(appPath, 'Contents', 'Resources'));
  }

  return [path.join(outputPath, 'resources')];
}

function copyRobbotRuntimeResources(outputPaths) {
  const repoRoot = path.resolve(__dirname, '../..');
  const configSource = path.join(repoRoot, 'config');
  const dshRuntimeSource = preparedDshRuntimeBundle ?? buildDshRuntimeBundle();
  const nodeExecutable = preparedNodeExecutable ?? prepareNodeRuntime();

  for (const outputPath of outputPaths) {
    for (const resourceDir of resourceDirsForPackageOutput(outputPath)) {
      console.log(`[robbot:package] copying Robbot config to ${path.join(resourceDir, 'config')}`);
      copyRobbotConfig(configSource, path.join(resourceDir, 'config'));
      writeRobbotRuntimeEnv(resourceDir);
      console.log(`[robbot:package] copying DSH runtime bundle to ${path.join(resourceDir, 'dsh-runtime')}`);
      const packagedDshRuntime = path.join(resourceDir, 'dsh-runtime');
      copyDirectory(dshRuntimeSource, packagedDshRuntime, { verbatimSymlinks: true });
      console.log('[robbot:package] DSH runtime bundle copied');
      const nodeTarget = path.join(resourceDir, 'bin', process.platform === 'win32' ? 'node.exe' : 'node');
      console.log(`[robbot:package] copying Node runtime to ${nodeTarget}`);
      fsSync.mkdirSync(path.dirname(nodeTarget), { recursive: true });
      fsSync.copyFileSync(nodeExecutable, nodeTarget);
      fsSync.chmodSync(nodeTarget, 0o755);
      logPackageSizeAudit(resourceDir);
    }
  }
}

function buildDshRuntimeBundle() {
  const runtimePath = path.join(__dirname, '.runtime', 'dsh');
  if (fsSync.existsSync(path.join(runtimePath, 'package.json')) && fsSync.existsSync(path.join(runtimePath, 'lib', 'bin.js')) && isCurrentDshRuntimeBundle(runtimePath)) {
    console.log(`[robbot:package] reusing DSH runtime bundle at ${runtimePath}`);
    materializeExternalSymlinks(runtimePath);
    return runtimePath;
  }

  console.log(`[robbot:package] building DSH runtime bundle at ${runtimePath}`);
  const result = spawnSync(process.execPath, [path.join(__dirname, 'scripts', 'build-dsh-runtime.mjs'), runtimePath], {
    cwd: __dirname,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`build-dsh-runtime.mjs exited with ${String(result.status)}`);
  }

  console.log('[robbot:package] DSH runtime bundle built');
  materializeExternalSymlinks(runtimePath);
  return runtimePath;
}

function isCurrentDshRuntimeBundle(runtimePath) {
  try {
    const marker = JSON.parse(fsSync.readFileSync(path.join(runtimePath, 'robbot-runtime.json'), 'utf8'));
    return marker?.kind === 'robbot-dsh-runtime'
      && marker?.layoutVersion === 4
      && isCurrentRuntimePluginManifest(runtimePath);
  } catch {
    return false;
  }
}

function isCurrentRuntimePluginManifest(runtimePath) {
  const repoRoot = path.resolve(__dirname, '../..');
  const sourceManifestPath = path.join(repoRoot, 'runtime-plugins', 'manifest.json');
  const runtimeManifestPath = path.join(runtimePath, 'manifest.json');
  if (!fsSync.existsSync(sourceManifestPath)) {
    return !fsSync.existsSync(runtimeManifestPath);
  }
  if (!fsSync.existsSync(runtimeManifestPath)) {
    return false;
  }
  return fsSync.readFileSync(sourceManifestPath, 'utf8') === fsSync.readFileSync(runtimeManifestPath, 'utf8');
}

function prepareNodeRuntime() {
  const runtimeBinDir = path.join(__dirname, '.runtime', 'bin');
  const nodeTarget = path.join(runtimeBinDir, process.platform === 'win32' ? 'node.exe' : 'node');

  fsSync.mkdirSync(runtimeBinDir, { recursive: true });
  fsSync.copyFileSync(process.execPath, nodeTarget);
  fsSync.chmodSync(nodeTarget, 0o755);

  if (process.platform !== 'win32') {
    const stripResult = spawnSync('strip', ['-x', '-S', nodeTarget], {
      stdio: 'pipe',
    });
    const codesignResult = stripResult.status === 0 && process.platform === 'darwin'
      ? spawnSync('codesign', ['--force', '--sign', '-', nodeTarget], { stdio: 'pipe' })
      : undefined;
    if (stripResult.error || stripResult.status !== 0 || codesignResult?.status !== 0 || codesignResult?.error) {
      const detail = stripResult.error?.message
        ?? stripResult.stderr?.toString().trim()
        ?? codesignResult?.error?.message
        ?? codesignResult?.stderr?.toString().trim()
        ?? `exit ${String(stripResult.status)}`;
      console.warn(`[robbot:package] unable to strip Node runtime (${detail}); using unstripped Node`);
      fsSync.copyFileSync(process.execPath, nodeTarget);
      fsSync.chmodSync(nodeTarget, 0o755);
    }
  }

  console.log(`[robbot:package] prepared Node runtime at ${nodeTarget} (${formatBytes(directorySizeBytes(nodeTarget))})`);
  return nodeTarget;
}

function copyRobbotConfig(sourcePath, targetPath) {
  copyDirectory(sourcePath, targetPath);
  const runtimeConfigPath = path.join(targetPath, 'dsh-runtime.json');
  const runtimeConfig = JSON.parse(fsSync.readFileSync(runtimeConfigPath, 'utf8'));
  fsSync.writeFileSync(runtimeConfigPath, `${JSON.stringify({
    ...runtimeConfig,
    submodule: 'dsh-runtime',
    buildRequired: false,
    configPath: '../config/dsh-sdk-flash.cordis.yml',
  }, null, 2)}\n`);
}

function writeRobbotRuntimeEnv(resourceDir) {
  const repoRoot = path.resolve(__dirname, '../..');
  const publicApiUrl = firstNonEmptyValue(
    process.env.PUBLIC_API_URL,
    readDotEnvValue(path.join(__dirname, 'renderer', '.env'), 'PUBLIC_API_URL'),
    readDotEnvValue(path.join(repoRoot, '.env'), 'PUBLIC_API_URL'),
  );
  const robbotApiUrl = firstNonEmptyValue(
    process.env.ROBBOT_API_URL,
    readDotEnvValue(path.join(__dirname, '.env'), 'ROBBOT_API_URL'),
    readDotEnvValue(path.join(repoRoot, '.env'), 'ROBBOT_API_URL'),
    publicApiUrl,
  );

  if (!publicApiUrl && !robbotApiUrl) {
    console.warn('[robbot:package] PUBLIC_API_URL/ROBBOT_API_URL is not configured for packaged auth');
    return;
  }

  const lines = [];
  if (publicApiUrl) {
    lines.push(`PUBLIC_API_URL=${publicApiUrl}`);
  }
  if (robbotApiUrl) {
    lines.push(`ROBBOT_API_URL=${robbotApiUrl}`);
  }

  const envTarget = path.join(resourceDir, '.env');
  fsSync.writeFileSync(envTarget, `${lines.join('\n')}\n`);
  console.log(`[robbot:package] wrote packaged auth env to ${envTarget}`);
}

function firstNonEmptyValue(...values) {
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

function readDotEnvValue(filename, name) {
  if (!fsSync.existsSync(filename)) {
    return undefined;
  }

  const prefix = `${name}=`;
  for (const line of fsSync.readFileSync(filename, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.startsWith(prefix)) {
      continue;
    }

    return unquoteDotEnvValue(trimmed.slice(prefix.length).trim());
  }

  return undefined;
}

function unquoteDotEnvValue(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function ensureGitignoreForAsar(buildPath, _electronVersion, _platform, _arch, callback) {
  const gitignorePath = path.join(buildPath, '.gitignore');

  try {
    if (!fsSync.existsSync(gitignorePath)) {
      fsSync.writeFileSync(gitignorePath, '');
    }
    callback();
  } catch (error) {
    callback(error);
  }
}

function sanitizePackagedDshHomeTemplate() {
  const profileNodeModulesPath = path.join(__dirname, '.dsh-home', 'profiles', 'node_modules');
  if (!fsSync.existsSync(profileNodeModulesPath)) {
    return;
  }

  fsSync.rmSync(profileNodeModulesPath, { force: true, recursive: true });
  console.log(`[robbot:package] removed template DSH profile node_modules at ${profileNodeModulesPath}`);
}

module.exports = {
  hooks: {
    async prePackage() {
      // Electron Packager walks appDir/node_modules directly. With pnpm's
      // hoisted layout, Node can resolve Electron from the workspace root,
      // but Packager cannot. A link keeps the path visible without copying
      // Electron.app into the development tree.
      ensureElectronPackageLinks();
      materializeRuntimeDependencies();
      preparedDshRuntimeBundle = buildDshRuntimeBundle();
      preparedNodeExecutable = prepareNodeRuntime();
      sanitizePackagedDshHomeTemplate();
    },
    async postPackage(_forgeConfig, packageResult) {
      try {
        copyRobbotRuntimeResources(packageResult.outputPaths);
      } finally {
        cleanupElectronPackageLinks();
      }
    },
    async postMake(_forgeConfig, makeResults) {
      logArtifactSizeAudit(makeResults);
    },
    async preMake() {
      if (process.platform === 'win32') {
        prepareElectronWinstallerVendor();
      }
    },
  },
  packagerConfig: {
    asar: true,
    beforeAsar: [ensureGitignoreForAsar],
    electronVersion,
    executableName: 'Robbot',
    icon: path.resolve(__dirname, 'assets/icon'),
    ignore: [
      /^\/renderer\/node_modules(\/|$)/,
      /^\/renderer\/src(\/|$)/,
      /^\/renderer\/public(\/|$)/,
      /^\/renderer\/\.gitignore$/,
      /^\/renderer\/README\.md$/,
      /^\/renderer\/eslint\.config\.js$/,
      /^\/renderer\/index\.html$/,
      /^\/renderer\/package-lock\.json$/,
      /^\/renderer\/package\.json$/,
      /^\/renderer\/tsconfig.*\.json$/,
      /^\/renderer\/vite\.config\.ts$/,
      /^\/electron\/.*\.ts$/,
      /^\/tsconfig\.electron\.json$/,
      /^\/\.runtime(\/|$)/,
      /^\/\.dsh-home\/profiles\/node_modules(\/|$)/,
      /^\/node_modules\/electron(\/|$)/,
      /^\/node_modules\/@electron(\/|$)/,
      /^\/node_modules\/@electron-internal(\/|$)/,
    ],
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'robbot',
        setupExe: 'RobbotSetup.exe',
        setupIcon: path.resolve(__dirname, 'assets/icon.ico'),
        loadingGif: path.resolve(__dirname, 'assets/install-loading.gif'),
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'huiruo',
          name: 'robbot',
        },
        // Keep releases as drafts until the artifacts have been reviewed.
        draft: true,
        prerelease: false,
        generateReleaseNotes: true,
      },
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
