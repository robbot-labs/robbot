import { spawn } from 'node:child_process';
import { constants, accessSync, existsSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const runtimeBin = path.join(repoRoot, 'apps', 'desktop', '.runtime', 'bin');
const command = process.argv[2];
const args = process.argv.slice(3);

if (!command) {
  console.error('Usage: node scripts/with-runtime-node.mjs <command> [...args]');
  process.exit(1);
}

const delimiter = process.platform === 'win32' ? ';' : ':';
const env = { ...process.env };

if (isExecutable(path.join(runtimeBin, process.platform === 'win32' ? 'node.exe' : 'node'))) {
  env.PATH = `${runtimeBin}${delimiter}${env.PATH ?? ''}`;
}

const child = spawn(command, args, {
  cwd: repoRoot,
  env,
  shell: process.platform === 'win32',
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});

function isExecutable(filePath) {
  if (!existsSync(filePath)) return false;
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
