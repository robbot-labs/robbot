import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(appDir, '../..');

const workspacePackages = [
  ['@robbot/core', path.join(repoRoot, 'packages', 'core')],
  ['@robbot/dsh-adapter', path.join(repoRoot, 'packages', 'dsh-adapter')],
];

for (const [packageName, sourcePath] of workspacePackages) {
  const targetPath = path.join(appDir, 'node_modules', ...packageName.split('/'));
  copyPackageDirectory(sourcePath, targetPath);
  writeRuntimePackageManifest(targetPath);
  console.log(`[robbot:desktop] synced ${packageName} to ${path.relative(repoRoot, targetPath)}`);
}

function copyPackageDirectory(sourcePath, targetPath) {
  const sourceRealPath = fs.realpathSync(sourcePath);
  fs.rmSync(targetPath, { force: true, recursive: true });
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.cpSync(sourceRealPath, targetPath, {
    dereference: true,
    recursive: true,
    filter(source) {
      if (source === sourceRealPath) {
        return true;
      }

      return !path.relative(sourceRealPath, source).split(path.sep).some((part) => [
        '.git',
        '.turbo',
        'node_modules',
        'src',
      ].includes(part));
    },
  });
}

function writeRuntimePackageManifest(packageDir) {
  const packageJsonPath = path.join(packageDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  fs.writeFileSync(packageJsonPath, `${JSON.stringify({
    ...packageJson,
    types: './dist/index.d.ts',
    exports: {
      '.': {
        types: './dist/index.d.ts',
        default: './dist/index.js',
      },
    },
  }, null, 2)}\n`);
}
