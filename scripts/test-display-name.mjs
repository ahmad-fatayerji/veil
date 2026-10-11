// Actual Windows/WebView2 display-name preference and restart acceptance.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

assert.equal(process.platform, 'win32');
const root = resolve(import.meta.dirname, '..');
await mkdir(resolve(root, 'target/display-name-acceptance'), { recursive: true });
const directory = await mkdtemp(resolve(root, 'target/display-name-acceptance/run-'));
const listener = createServer();
await new Promise((done, reject) => {
  listener.once('error', reject);
  listener.listen(0, '127.0.0.1', done);
});
const port = listener.address().port;
await new Promise((done) => listener.close(done));
const endpoint = `http://127.0.0.1:${port}`;
let app, browser;
const errors = [];
async function waitFor(check) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error('Display-name acceptance timed out');
}
async function launch() {
  app = spawn(
    resolve(process.env.VEIL_NAME_TEST_EXE || resolve(root, 'target/debug/veil-desktop.exe')),
    [],
    {
      cwd: root,
      windowsHide: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        VEIL_TEST_SETTINGS_DIR: directory,
        WEBVIEW2_USER_DATA_FOLDER: resolve(directory, 'webview'),
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      },
    },
  );
  await waitFor(async () => (await fetch(`${endpoint}/json/version`).catch(() => null))?.ok);
  browser = await chromium.connectOverCDP(endpoint);
  const pages = () => browser.contexts().flatMap((context) => context.pages());
  await waitFor(() => pages().some((page) => page.url().includes('?overlay')));
  const main = pages().find((page) => !page.url().includes('?overlay'));
  for (const page of pages()) page.on('pageerror', (error) => errors.push(error.message));
  await expect(main.locator('#automatic-name')).toBeVisible();
  return main;
}
async function appearance(main) {
  await main.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = main.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('button', { name: 'Appearance', exact: true }).click();
  return settings;
}
async function quit(main) {
  await main.evaluate(() => window.__TAURI_INTERNALS__.invoke('app_quit')).catch(() => {});
  await waitFor(() => app.exitCode !== null);
  assert.equal(app.exitCode, 0);
  await browser.close();
  browser = null;
  await waitFor(async () => !(await fetch(`${endpoint}/json/version`).catch(() => null))?.ok);
}
try {
  let main = await launch();
  await expect(main.locator('#automatic-name')).toHaveValue('');
  await main.locator('#automatic-name').fill('Create name');
  let settings = await appearance(main);
  await expect(settings.getByLabel('Your name', { exact: true })).toHaveValue('Create name');
  await settings.getByLabel('Your name', { exact: true }).fill('Saved appearance name');
  await quit(main);

  main = await launch();
  await expect(main.locator('#automatic-name')).toHaveValue('Saved appearance name');
  await main.getByRole('tab', { name: 'Join session', exact: true }).click();
  await expect(main.locator('#automatic-name')).toHaveValue('Saved appearance name');
  await main.locator('#automatic-name').fill('Join name');
  settings = await appearance(main);
  await expect(settings.getByLabel('Your name', { exact: true })).toHaveValue('Join name');
  await settings.getByRole('button', { name: 'Close Settings', exact: true }).click();
  await main.getByRole('tab', { name: 'Create document', exact: true }).click();
  await main.getByRole('button', { name: 'Create document', exact: true }).click();
  await main.locator('.tiptap').fill('Keep this document while changing my name');
  settings = await appearance(main);
  await settings.getByLabel('Your name', { exact: true }).fill('');
  await settings.getByRole('button', { name: 'Close Settings', exact: true }).click();
  await expect(main.locator('.tiptap')).toContainText('Keep this document while changing my name');
  await main.screenshot({ path: resolve(directory, 'cleared-name-document.png') });
  await quit(main);

  main = await launch();
  await expect(main.locator('#automatic-name')).toHaveValue('');
  await expect(main.locator('#automatic-name')).toHaveAttribute('maxlength', '40');
  await main.getByRole('tab', { name: 'Join session', exact: true }).click();
  await main.locator('#automatic-invitation').fill('invalid invitation');
  await expect(main.getByRole('button', { name: 'Join session', exact: true })).toBeDisabled();
  settings = await appearance(main);
  await expect(settings.getByLabel('Your name', { exact: true })).toHaveValue('');
  await quit(main);
  assert.deepEqual(errors, []);
  console.log(
    `PASS: saved name survives process restart, create/join reuse it, clearing persists, empty join stays disabled, and active document survives rename. Evidence: ${directory}`,
  );
} finally {
  if (browser) await browser.close().catch(() => {});
  if (app?.exitCode === null) app.kill();
}
