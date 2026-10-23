import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const directory = resolve(homedir(), '.veil', 'release-signing');
const env = { ...process.env };
const sdk = resolve(env.VEIL_DISCORD_SDK_DIR || '.local/discord-social-sdk');
const sdkConfig = [];
if (!env.VEIL_DISCORD_SDK_DISABLED && existsSync(resolve(sdk, 'include/discordpp.h'))) {
  env.VEIL_DISCORD_SDK_DIR = sdk;
  sdkConfig.push(
    '--config',
    JSON.stringify({
      bundle: {
        resources: {
          [resolve(sdk, 'bin/release/discord_partner_sdk.dll')]: 'discord_partner_sdk.dll',
          [resolve(sdk, 'License-Notices.txt')]: 'Discord-License-Notices.txt',
        },
      },
    }),
  );
}
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
    ...sdkConfig,
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
