// Actual Windows/WebView2 close-to-tray and explicit quit acceptance.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { chromium, expect } from '@playwright/test';

assert.equal(process.platform, 'win32');
const root = resolve(import.meta.dirname, '..');
await mkdir(resolve(root, 'target/tray-acceptance'), { recursive: true });
const directory = await mkdtemp(resolve(root, 'target/tray-acceptance/run-'));
const endpoint = 'http://127.0.0.1:9252';
await new Promise((done, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(9252, '127.0.0.1', () => server.close(done));
});
function launch() {
  return spawn(
    resolve(process.env.VEIL_TRAY_TEST_EXE || resolve(root, 'target/debug/veil-desktop.exe')),
    [],
    {
      cwd: root,
      windowsHide: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        VEIL_TEST_SETTINGS_DIR: directory,
        WEBVIEW2_USER_DATA_FOLDER: resolve(directory, 'webview'),
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9252',
      },
    },
  );
}
let app = launch();
let browser;
const errors = [];
async function waitFor(check) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error('Native acceptance timed out');
}
function native(action, window, extra = []) {
  const result = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      resolve(root, 'scripts/overlay-native.ps1'),
      '-Action',
      action,
      '-AppProcessId',
      String(app.pid),
      '-Window',
      window,
      ...extra,
    ],
    { windowsHide: true, encoding: 'utf8' },
  ).trim();
  return result ? JSON.parse(result) : undefined;
}
const invoke = (page, command, args) =>
  page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
    command,
    args,
  });
try {
  await waitFor(async () => (await fetch(`${endpoint}/json/version`).catch(() => null))?.ok);
  browser = await chromium.connectOverCDP(endpoint);
  const pages = () => browser.contexts().flatMap((context) => context.pages());
  await waitFor(() => pages().some((page) => page.url().includes('?overlay')));
  const main = pages().find((page) => !page.url().includes('?overlay'));
  const overlay = pages().find((page) => page.url().includes('?overlay'));
  for (const page of pages()) page.on('pageerror', (error) => errors.push(error.message));
  await main.getByRole('button', { name: 'Create document', exact: true }).click();
  await main.locator('.tiptap').fill('Tray keeps my temporary document');
  await invoke(main, 'overlay_visibility', { visible: true });
  await expect(overlay.locator('.tiptap')).toContainText('Tray keeps my temporary document');
  assert.equal(
    await overlay
      .locator('.overlay-surface')
      .evaluate((element) => getComputedStyle(element).borderRadius),
    '0px',
  );
  const originalBounds = (await invoke(main, 'overlay_snapshot')).settings;
  await overlay.screenshot({ path: resolve(directory, 'overlay-square-close.png') });
  await overlay.getByRole('button', { name: 'Hide overlay', exact: true }).click();
  await waitFor(() => !native('Probe', 'overlay').visible);
  const hidden = (await invoke(main, 'overlay_snapshot')).settings;
  assert.equal(hidden.visible, false);
  for (const property of ['x', 'y', 'width', 'height']) {
    assert.equal(hidden[property], originalBounds[property], `Close must not drag: ${property}`);
  }
  assert.equal(app.exitCode, null);
  await expect(main.locator('.tiptap')).toContainText('Tray keeps my temporary document');
  const forbiddenShow = await overlay.evaluate(async () => {
    try {
      await window.__TAURI_INTERNALS__.invoke('overlay_visibility', { visible: true });
      return null;
    } catch (error) {
      return error;
    }
  });
  assert.equal(forbiddenShow?.code, 'FORBIDDEN');
  assert.match(forbiddenShow.message, /Use the control panel/);
  await invoke(main, 'overlay_visibility', { visible: true });
  await expect(overlay.locator('.tiptap')).toContainText('Tray keeps my temporary document');
  native('Move', 'overlay', [
    '-X',
    String(originalBounds.x),
    '-Y',
    String(originalBounds.y),
    '-Width',
    '280',
    '-Height',
    '180',
  ]);
  await waitFor(async () => (await invoke(main, 'overlay_snapshot')).settings.width === 280);
  const closeFits = await overlay.locator('.overlay-close').evaluate((element) => {
    const button = element.getBoundingClientRect();
    const header = element.closest('header').getBoundingClientRect();
    return (
      button.left >= header.left && button.right <= header.right && button.bottom <= header.bottom
    );
  });
  assert.equal(closeFits, true, 'Close button must fit the compact header');
  await overlay.screenshot({ path: resolve(directory, 'overlay-compact-close.png') });
  await overlay.getByRole('button', { name: 'Hide overlay', exact: true }).focus();
  await overlay.keyboard.press('Enter');
  await waitFor(() => !native('Probe', 'overlay').visible);
  await invoke(main, 'overlay_visibility', { visible: true });
  native('Move', 'overlay', [
    '-X',
    String(originalBounds.x),
    '-Y',
    String(originalBounds.y),
    '-Width',
    String(originalBounds.width),
    '-Height',
    String(originalBounds.height),
  ]);
  console.log(
    'PASS: square overlay, pointer/keyboard close, preserved document/bounds and show authorization',
  );
  native('Close', 'main');
  await waitFor(() => !native('Probe', 'main').visible);
  assert.equal(app.exitCode, null);
  assert.equal(native('Probe', 'overlay').visible, true);
  await overlay.locator('.tiptap').fill('Edited while main is in tray');
  await expect(main.locator('.tiptap')).toContainText('Edited while main is in tray');
  console.log('PASS: hidden main retains an editable, visible overlay');
  await assert.rejects(invoke(overlay, 'app_quit'), /Only the control panel/);
  native('Focus', 'main');
  await waitFor(() => native('Probe', 'main').visible);
  await main.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = main.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(settings.getByLabel('When closing the main window')).toHaveValue('tray');
  await expect(settings.getByRole('button', { name: 'Quit Veil', exact: true })).toHaveCount(0);
  await expect(
    settings.getByText('Fully closes Veil and its overlay, ending your session.'),
  ).toHaveCount(0);
  await main.screenshot({ path: resolve(directory, 'settings.png') });
  await settings.getByLabel('When closing the main window').selectOption('quit');
  await waitFor(
    async () => (await invoke(main, 'overlay_snapshot')).settings.closeBehavior === 'quit',
  );
  await overlay.getByRole('button', { name: 'Hide overlay', exact: true }).click();
  await waitFor(() => !native('Probe', 'overlay').visible);
  assert.equal(app.exitCode, null, 'Overlay close must hide even when main close quits');
  await invoke(main, 'overlay_visibility', { visible: true });
  await expect(main.getByRole('dialog', { name: 'Quit Veil?', exact: true })).toHaveCount(0);
  await settings.getByLabel('When closing the main window').selectOption('tray');
  await waitFor(
    async () => (await invoke(main, 'overlay_snapshot')).settings.closeBehavior === 'tray',
  );
  native('Close', 'main');
  await waitFor(() => !native('Probe', 'main').visible);
  // Exercise the native shutdown shared by tray Quit Veil and app_quit.
  // This does not simulate a physical tray-menu click.
  await invoke(main, 'app_quit').catch(() => {});
  await waitFor(() => app.exitCode !== null);
  assert.equal(app.exitCode, 0);
  assert.equal(
    JSON.parse(await readFile(resolve(directory, 'overlay.json'), 'utf8')).closeBehavior,
    'tray',
  );
  await browser.close();
  await waitFor(async () => !(await fetch(`${endpoint}/json/version`).catch(() => null))?.ok);
  app = launch();
  await waitFor(async () => (await fetch(`${endpoint}/json/version`).catch(() => null))?.ok);
  browser = await chromium.connectOverCDP(endpoint);
  await waitFor(() => pages().some((page) => page.url().includes('?overlay')));
  const restarted = pages().find((page) => !page.url().includes('?overlay'));
  restarted.on('pageerror', (error) => errors.push(error.message));
  await restarted.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(restarted.getByLabel('When closing the main window')).toHaveValue('tray');
  await restarted.getByLabel('When closing the main window').selectOption('quit');
  await waitFor(
    async () => (await invoke(restarted, 'overlay_snapshot')).settings.closeBehavior === 'quit',
  );
  await restarted.getByRole('button', { name: 'Close Settings', exact: true }).click();
  await restarted.getByRole('button', { name: 'Create document', exact: true }).click();
  await restarted.locator('.tiptap').fill('Window close quits even with a temporary document');
  await invoke(restarted, 'overlay_visibility', { visible: true });
  assert.equal(native('Probe', 'overlay').visible, true);
  native('Close', 'main');
  await waitFor(() => app.exitCode !== null);
  assert.equal(app.exitCode, 0);
  assert.deepEqual(errors, []);
  console.log(
    `PASS: default tray behavior, immediate native close in Quit mode, immediate native quit, overlay preservation and preference restart. Evidence: ${directory}`,
  );
} finally {
  if (browser) await browser.close().catch(() => {});
  if (app.exitCode === null) app.kill();
}
