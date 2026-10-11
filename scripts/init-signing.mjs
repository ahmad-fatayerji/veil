// Private key/password never enter this repository or tool output.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const directory = resolve(homedir(), '.veil', 'release-signing');
mkdirSync(directory, { recursive: true });
const sid = execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-Command',
    '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
  ],
  { encoding: 'utf8', windowsHide: true },
).trim();
execFileSync('icacls.exe', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], {
  stdio: 'ignore',
  windowsHide: true,
});
const key = resolve(directory, 'veil.key');
const passwordFile = resolve(directory, 'password.txt');
if (!existsSync(key)) {
  const password = randomBytes(32).toString('base64url');
  writeFileSync(passwordFile, password);
  const cli = resolve('apps/desktop/node_modules/@tauri-apps/cli/tauri.js');
  try {
    execFileSync(process.execPath, [cli, 'signer', 'generate', '--ci', '-p', password, '-w', key], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch {
    throw new Error(
      'Signing key generation failed. Command details are hidden to protect credentials.',
    );
  }
}
if (!existsSync(passwordFile) || !existsSync(`${key}.pub`))
  throw new Error('Signing key backup is incomplete; do not overwrite existing keys.');
const path = resolve('apps/desktop/src-tauri/tauri.conf.json');
const config = JSON.parse(readFileSync(path, 'utf8'));
config.bundle.createUpdaterArtifacts = true;
config.plugins = {
  ...config.plugins,
  updater: {
    requireSignedVersion: true,
    pubkey: readFileSync(`${key}.pub`, 'utf8').trim(),
    endpoints: ['https://github.com/ahmad-fatayerji/veil/releases/latest/download/latest.json'],
    windows: { installMode: 'passive' },
  },
};
writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
console.log(
  `Updater public key configured. Private signing backup: ${directory}. Keep this directory private and backed up.`,
);
