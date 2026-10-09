// Real WebView2 channel selection, persistence and native administration boundary.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

assert.equal(process.platform, 'win32');
const root = resolve(import.meta.dirname, '..');
await mkdir(resolve(root, 'target/update-acceptance'), { recursive: true });
const directory = await mkdtemp(resolve(root, 'target/update-acceptance/run-'));
const endpoint = 'http://127.0.0.1:9236';
let app, browser;
const errors = [];
async function waitFor(check) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error('Timed out waiting for native updates UI.');
}
async function launch() {
  assert.equal(
    await fetch(`${endpoint}/json/version`).catch(() => null),
    null,
    'Port 9236 must be free.',
  );
  app = spawn(resolve(root, 'target/debug/veil-desktop.exe'), [], {
    cwd: root,
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      VEIL_TEST_SETTINGS_DIR: directory,
      WEBVIEW2_USER_DATA_FOLDER: resolve(directory, 'webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        '--remote-debugging-port=9236 --remote-debugging-address=127.0.0.1',
    },
  });
  await waitFor(async () => (await fetch(`${endpoint}/json/version`).catch(() => null))?.ok);
  browser = await chromium.connectOverCDP(endpoint);
  const pages = () => browser.contexts().flatMap((context) => context.pages());
  await waitFor(() => pages().some((page) => !page.url().includes('?overlay')));
  const page = pages().find((item) => !item.url().includes('?overlay'));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('summary').filter({ hasText: 'App updates' }).click();
  await page.getByLabel('Update channel').waitFor();
  await waitFor(() => page.getByLabel('Update channel').isEnabled());
  return page;
}
async function close() {
  await browser?.close();
  browser = null;
  if (app && app.exitCode === null) {
    app.kill();
    await new Promise((done) => app.once('exit', done));
  }
  app = null;
  await waitFor(async () => !(await fetch(`${endpoint}/json/version`).catch(() => null))?.ok);
}
try {
  let page = await launch();
  assert.equal(await page.getByLabel('Update channel').inputValue(), 'stable');
  await page.getByLabel('Update channel').selectOption('beta');
  await waitFor(
    async () =>
      JSON.parse(
        await readFile(resolve(directory, 'update-channel.json'), 'utf8').catch(() => 'null'),
      ) === 'beta',
  );
  await page.screenshot({ path: resolve(directory, 'beta.png') });
  await close();
  page = await launch();
  assert.equal(await page.getByLabel('Update channel').inputValue(), 'beta');
  const overlay = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((item) => item.url().includes('?overlay'));
  await overlay.waitForLoadState('domcontentloaded');
  const rejected = await overlay.evaluate(async () => {
    try {
      await window.__TAURI_INTERNALS__.invoke('update_set_channel', { channel: 'stable' });
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(rejected, true, 'Overlay cannot change updater settings.');
  await page.getByLabel('Update channel').selectOption('stable');
  await waitFor(
    async () =>
      JSON.parse(await readFile(resolve(directory, 'update-channel.json'), 'utf8')) === 'stable',
  );
  assert.deepEqual(errors, []);
  console.log(`Native channel persistence and authorization passed: ${directory}`);
} finally {
  await close();
}
