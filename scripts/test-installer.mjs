// Install a real production bundle in a temporary path, preserving user preferences.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, unlink } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { chromium } from '@playwright/test';

assert.equal(process.platform, 'win32');
const root = resolve(import.meta.dirname, '..');
const installer = resolve(process.argv[2] ?? 'target/release/bundle/nsis/Veil_0.1.0_x64-setup.exe');
const expectedVersion = /^Veil_(.+)_x64-setup.exe$/.exec(basename(installer))?.[1];
assert.ok(expectedVersion);
const updateTo = process.argv[3];
const registered = execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-Command',
    "@(Get-ItemProperty 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/*' -ErrorAction SilentlyContinue | Where-Object DisplayName -EQ 'Veil').Count",
  ],
  { encoding: 'utf8', windowsHide: true },
).trim();
assert.equal(
  registered,
  '0',
  'Do not replace an existing user installation. Use a clean test account instead.',
);
await mkdir(resolve(root, 'target/installer-acceptance'), { recursive: true });
const directory = await mkdtemp(resolve(root, 'target/installer-acceptance/run-'));
const installed = resolve(directory, 'app');
const appdata = execFileSync(
  'powershell.exe',
  ['-NoProfile', '-Command', "[Environment]::GetFolderPath('ApplicationData')"],
  { encoding: 'utf8', windowsHide: true },
).trim();
const preferences = resolve(appdata, 'dev.veil.desktop', 'overlay.json');
const originalPreferences = await readFile(preferences).catch((error) => {
  if (error.code === 'ENOENT') return null;
  throw error;
});
let app, browser;
let installedSuccessfully = false;
const errors = [];
const endpoint = 'http://127.0.0.1:9235';
async function waitFor(check, label) {
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`Timed out: ${label}`);
}
function run(file, args) {
  return new Promise((done, reject) => {
    const process = spawn(file, args, { windowsHide: true, stdio: 'ignore' });
    process.on('error', reject);
    process.on('exit', (code) =>
      code === 0 ? done() : reject(new Error(`Installer exited ${code}`)),
    );
  });
}
async function launch() {
  assert.equal(
    await fetch(`${endpoint}/json/version`).catch(() => null),
    null,
    'Port 9235 must be free',
  );
  app = spawn(resolve(installed, 'veil-desktop.exe'), [], {
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      WEBVIEW2_USER_DATA_FOLDER: resolve(directory, 'webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        '--remote-debugging-port=9235 --remote-debugging-address=127.0.0.1',
    },
  });
  await waitFor(
    async () => (await fetch(`${endpoint}/json/version`).catch(() => null))?.ok,
    'installed WebView2',
  );
  browser = await chromium.connectOverCDP(endpoint);
  const pages = () => browser.contexts().flatMap((context) => context.pages());
  await waitFor(
    () => pages().some((page) => !page.url().includes('?overlay')),
    'installed main window',
  );
  const page = pages().find((page) => !page.url().includes('?overlay'));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByLabel('Your name', { exact: true }).waitFor();
  await waitFor(
    () => pages().some((page) => page.url().includes('?overlay')),
    'installed overlay window',
  );
  return page;
}
async function close() {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
  if (installedSuccessfully) {
    const requestClose = () =>
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          'Get-CimInstance Win32_Process -Filter "name=\'veil-desktop.exe\'" | Where-Object ExecutablePath -EQ $env:VEIL_INSTALLED_TEST_EXE | ForEach-Object { (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).CloseMainWindow() | Out-Null }',
        ],
        {
          windowsHide: true,
          env: { ...process.env, VEIL_INSTALLED_TEST_EXE: resolve(installed, 'veil-desktop.exe') },
        },
      );
    await waitFor(async () => {
      requestClose();
      return !(await fetch(`${endpoint}/json/version`).catch(() => null))?.ok;
    }, 'clean app close');
  }
}
const invoke = (page, command, args) =>
  page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
    command,
    args,
  });
try {
  await run(installer, ['/S', `/D=${installed}`]);
  installedSuccessfully = true;
  let page = await launch();
  let info = await invoke(page, 'update_status');
  assert.equal(info.currentVersion, expectedVersion);
  assert.equal(info.sessionActive, false);
  const overlay = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((page) => page.url().includes('?overlay'));
  const rejected = await invoke(overlay, 'update_check').then(
    () => false,
    (error) => String(error).includes('Only the control panel'),
  );
  assert.equal(rejected, true, 'Overlay cannot administer updates');
  await page.getByLabel('Your name', { exact: true }).fill('Installer test');
  await page.getByRole('button', { name: 'Start peer session', exact: true }).click();
  await waitFor(
    async () => (await invoke(page, 'update_status')).sessionActive,
    'native peer session guard',
  );
  assert.equal(
    await invoke(page, 'update_install').then(
      () => false,
      (error) => String(error).includes('End or leave'),
    ),
    true,
  );
  await page.getByRole('textbox', { name: 'Shared document' }).fill('Installed production editor.');
  await page.getByRole('button', { name: 'Show overlay', exact: true }).click();
  await waitFor(
    async () =>
      (await overlay.getByRole('textbox', { name: 'Shared document' }).textContent()) ===
      'Installed production editor.',
    'installed overlay',
  );
  await page.getByRole('button', { name: 'End peer session', exact: true }).click();
  await waitFor(
    async () => !(await invoke(page, 'update_status')).sessionActive,
    'ended session releases guard',
  );
  await invoke(page, 'overlay_update', { patch: { opacity: 0.63, fontSize: 26 } });
  await page.screenshot({ path: resolve(directory, 'installed.png'), fullPage: true });
  await close();
  // Reinstall the same package to check the NSIS maintenance path and preference retention.
  await run(installer, ['/S', `/D=${installed}`]);
  page = await launch();
  const settings = (await invoke(page, 'overlay_snapshot')).settings;
  assert.equal(settings.opacity, 0.63);
  assert.equal(settings.fontSize, 26);
  if (updateTo) {
    await page.locator('.desktop-updates summary').click();
    await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
    await waitFor(
      async () => (await invoke(page, 'update_status')).availableVersion === updateTo,
      'real HTTPS update feed',
    );
    await page.getByRole('button', { name: 'Install update and restart', exact: true }).click();
    await waitFor(() => app.exitCode !== null, 'updater exits old version');
    await browser.close().catch(() => {});
    browser = null;
    await waitFor(
      async () => (await fetch(`${endpoint}/json/version`).catch(() => null))?.ok,
      'updater relaunch',
    );
    browser = await chromium.connectOverCDP(endpoint);
    const pages = () => browser.contexts().flatMap((context) => context.pages());
    await waitFor(
      () =>
        pages().some(
          (candidate) => !candidate.url().includes('?overlay') && candidate.url().includes('tauri'),
        ),
      'updated main window',
    );
    page = pages().find(
      (candidate) => !candidate.url().includes('?overlay') && candidate.url().includes('tauri'),
    );
    await page.getByLabel('Your name', { exact: true }).waitFor();
    page.on('pageerror', (error) => errors.push(error.message));
    assert.equal((await invoke(page, 'update_status')).currentVersion, updateTo);
    const retained = (await invoke(page, 'overlay_snapshot')).settings;
    assert.equal(retained.opacity, 0.63);
    assert.equal(retained.fontSize, 26);
    await page.screenshot({ path: resolve(directory, 'updated.png'), fullPage: true });
    console.log(
      `Real signed HTTPS update ${expectedVersion} -> ${updateTo} preserved preferences and relaunched.`,
    );
  }
  assert.deepEqual(errors, []);
  await close();
  console.log(
    `Production installer, installed editor/overlay, updater authorization/session guard, maintenance reinstall and preference retention passed. Evidence: ${directory}`,
  );
} finally {
  await close();
  if (installedSuccessfully) await run(resolve(installed, 'uninstall.exe'), ['/S']);
  if (originalPreferences) {
    await mkdir(resolve(appdata, 'dev.veil.desktop'), { recursive: true });
    await writeFile(preferences, originalPreferences);
  } else
    await unlink(preferences).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
}
