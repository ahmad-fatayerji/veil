// Install an isolated-identity acceptance bundle, then exercise Windows URL dispatch.
// Refuses to replace an existing veil:// registration or acceptance installation.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

assert.equal(process.platform, 'win32');
const root = resolve(import.meta.dirname, '..');
const installer = resolve(process.argv[2]);
const ps = (command, env = {}) =>
  execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
assert.equal(
  ps('Test-Path HKCU:/Software/Classes/veil'),
  'False',
  'Preserve existing URL handlers: use a clean test account.',
);
assert.equal(
  ps("Test-Path 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/Veil UX acceptance'"),
  'False',
);
await mkdir(resolve(root, 'target/deep-link-acceptance'), { recursive: true });
const directory = await mkdtemp(resolve(root, 'target/deep-link-acceptance/run-'));
const installed = resolve(directory, 'app');
const executable = resolve(installed, 'veil-desktop.exe');
const env = {
  VEIL_ACCEPTANCE_EXE: executable,
  VEIL_TEST_SETTINGS_DIR: resolve(directory, 'settings'),
  VEIL_TEST_SINGLE_INSTANCE: '1',
  WEBVIEW2_USER_DATA_FOLDER: resolve(directory, 'webview'),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9250',
};
const run = (file, args) =>
  new Promise((done, reject) => {
    const child = spawn(file, args, { windowsHide: true, stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? done() : reject(new Error(`Installer exited ${code}`)),
    );
  });
async function waitFor(check, label) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error(`Timed out: ${label}`);
}
const identity = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
  'sign',
  'verify',
]);
const payload = {
  version: 4,
  server: 'https://example.test',
  sessionId: 'a'.repeat(32),
  groupId: 'b'.repeat(32),
  secret: 'c'.repeat(64),
  hostClientId: 42,
  hostPublic: Buffer.from(await crypto.subtle.exportKey('raw', identity.publicKey)).toString(
    'base64',
  ),
};
const link = 'veil://join/' + Buffer.from(JSON.stringify(payload)).toString('base64url');
const open = (url) =>
  ps('Start-Process -FilePath $env:VEIL_ACCEPTANCE_URL -WindowStyle Hidden', {
    ...env,
    VEIL_ACCEPTANCE_URL: url,
  });
const processes = () =>
  ps(
    '@(Get-CimInstance Win32_Process -Filter "name=\'veil-desktop.exe\'" | Where-Object ExecutablePath -EQ $env:VEIL_ACCEPTANCE_EXE).Count',
    env,
  );
let browser,
  installedSuccessfully = false;
const errors = [];
try {
  await run(installer, ['/S', `/D=${installed}`]);
  installedSuccessfully = true;
  const handler = ps("(Get-Item 'HKCU:/Software/Classes/veil/shell/open/command').GetValue('')");
  assert.ok(handler.includes(executable), 'NSIS registers the installed executable');
  open(link);
  await waitFor(
    async () => (await fetch('http://127.0.0.1:9250/json/version').catch(() => null))?.ok,
    'cold URL launch',
  );
  browser = await chromium.connectOverCDP('http://127.0.0.1:9250');
  const pages = () => browser.contexts().flatMap((context) => context.pages());
  await waitFor(() => pages().some((page) => !page.url().includes('?overlay')), 'main window');
  const page = pages().find((page) => !page.url().includes('?overlay'));
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByLabel('Invite link')).toHaveValue(link);
  await expect(page.getByRole('button', { name: /^Join with a link/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  assert.equal(
    await page.getByRole('textbox', { name: 'Shared document' }).count(),
    0,
    'Opening a link never auto-joins',
  );
  open('veil://join/invalid');
  await expect(page.getByRole('alert')).toContainText('invalid');
  await page.getByRole('button', { name: /^New document/ }).click();
  const editor = page.getByRole('textbox', { name: 'Shared document' });
  await editor.fill('Keep this temporary document.');
  open(link);
  const confirmation = page.getByRole('dialog', { name: 'Open another session?' });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText('contains temporary content');
  assert.equal(processes(), '1', 'Warm activation delivers to one existing instance');
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editor).toHaveText('Keep this temporary document.');
  open(link);
  await confirmation.getByRole('button', { name: 'Leave and open invitation' }).click();
  await expect(page.getByLabel('Invite link')).toHaveValue(link);
  assert.equal(
    await page
      .evaluate(() => window.__TAURI_INTERNALS__.invoke('update_status'))
      .then((value) => value.sessionActive),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: isolated installed Windows URL registration, cold/warm activation, single instance, explicit Join, invalid link rejection, and active-document Cancel/Leave protection.',
  );
} finally {
  if (browser) await browser.close().catch(() => {});
  ps(
    'Get-CimInstance Win32_Process -Filter "name=\'veil-desktop.exe\'" | Where-Object ExecutablePath -EQ $env:VEIL_ACCEPTANCE_EXE | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }',
    env,
  );
  if (installedSuccessfully) await run(resolve(installed, 'uninstall.exe'), ['/S']);
}
