import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const directory = resolve(homedir(), '.veil', 'release-signing');
const env = { ...process.env };
if (!env.TAURI_SIGNING_PRIVATE_KEY) {
  env.TAURI_SIGNING_PRIVATE_KEY = resolve(directory, 'veil.key');
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = readFileSync(
    resolve(directory, 'password.txt'),
    'utf8',
  ).trim();
}
const child = spawn(
  process.execPath,
  [
    resolve('apps/desktop/node_modules/@tauri-apps/cli/tauri.js'),
    'build',
    '--bundles',
    'nsis',
    ...process.argv.slice(2),
  ],
  {
    cwd: resolve('apps/desktop'),
    env,
    stdio: 'inherit',
    windowsHide: true,
  },
);
child.on('error', () => {
  console.error('Unable to start installer build.');
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
