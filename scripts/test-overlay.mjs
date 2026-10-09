// Real Windows/WebView2 acceptance. Does not mock Tauri or window behavior.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from '@playwright/test';

assert.equal(process.platform, 'win32', 'Native overlay acceptance requires Windows.');
for (const port of [4445, 9223, 9224]) {
  await new Promise((done, reject) => {
    const server = createServer();
    server.once('error', () =>
      reject(
        new Error(`Port ${port} is occupied. Close its existing debug session before testing.`),
      ),
    );
    server.listen(port, '127.0.0.1', () => server.close(done));
  });
}
const root = resolve(import.meta.dirname, '..');
await mkdir(resolve(root, 'target/overlay-acceptance'), { recursive: true });
const directory = await mkdtemp(resolve(root, 'target/overlay-acceptance/run-'));
const endpoint = 'http://127.0.0.1:9223';
const exe = resolve(root, 'target/debug/veil-desktop.exe');
let app;
let browser;
let underlay;
let conflictingApp;
let conflictingBrowser;
let guestBrowser;
const errors = [];
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function waitFor(check, description, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(150);
  }
  throw new Error(`Timed out: ${description}`);
}
function native(action, args = {}, window = 'overlay', processId = app.pid) {
  const flags = Object.entries(args).flatMap(([key, value]) => [`-${key}`, String(value)]);
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
      String(processId),
      '-Window',
      window,
      ...flags,
    ],
    { windowsHide: true, encoding: 'utf8', stdio: 'pipe' },
  ).trim();
  return result ? JSON.parse(result) : undefined;
}
async function launch() {
  app = spawn(exe, [], {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      VEIL_TEST_SETTINGS_DIR: directory,
      WEBVIEW2_USER_DATA_FOLDER: resolve(directory, 'webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        '--remote-debugging-port=9223 --remote-debugging-address=127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stderr.on('data', (data) => process.stderr.write(data));
  await waitFor(async () => {
    try {
      return (await fetch(`${endpoint}/json/version`)).ok;
    } catch {
      return false;
    }
  }, 'WebView2 debug endpoint');
  browser = await chromium.connectOverCDP(endpoint);
  await waitFor(
    () =>
      browser
        .contexts()
        .flatMap((context) => context.pages())
        .some((page) => page.url().includes('?overlay')),
    'two native WebViews',
  );
  const pages = browser.contexts().flatMap((context) => context.pages());
  const overlay = pages.find((page) => page.url().includes('?overlay'));
  const main = pages.find((page) => page !== overlay);
  assert.ok(main && overlay, 'Separate control panel and overlay pages exist.');
  for (const page of pages) page.on('pageerror', (error) => errors.push(error.message));
  await main
    .getByRole('button', { name: 'Show overlay' })
    .waitFor({ state: 'visible' })
    .catch(() => main.getByRole('button', { name: 'Hide overlay' }).waitFor());
  await overlay.getByRole('article', { name: 'Overlay document' }).waitFor({ state: 'attached' });
  return { main, overlay };
}
async function close() {
  const stopped = new Promise((done) => app.once('exit', done));
  native('Close', {}, 'main');
  await Promise.race([
    stopped,
    delay(10000).then(() => {
      throw new Error('Native app did not exit cleanly.');
    }),
  ]);
  await browser.close();
  browser = undefined;
}
async function snapshot(page) {
  return page.evaluate(() => window.__TAURI_INTERNALS__.invoke('overlay_snapshot'));
}
async function setRange(page, name, value) {
  const slider = page.getByRole('slider', { name: new RegExp(name) });
  // Exercise keyboard accessibility and the actual UI binding, waiting for native acknowledgments.
  const minimum = Number(await slider.getAttribute('min'));
  const step = Number(await slider.getAttribute('step'));
  await slider.press('Home');
  await waitFor(
    async () => Number(await slider.inputValue()) === minimum && (await slider.isEnabled()),
    `${name} minimum`,
  );
  for (let expected = minimum + step; expected <= value; expected += step) {
    await slider.press('ArrowRight');
    await waitFor(
      async () => Number(await slider.inputValue()) === expected && (await slider.isEnabled()),
      `${name} ${expected}`,
    );
  }
}
async function dragRange(page, name) {
  const slider = page.getByRole('slider', { name: new RegExp(name) });
  await slider.evaluate((node) => {
    window.__rangeValues = [];
    node.addEventListener('input', () => window.__rangeValues.push(Number(node.value)));
  });
  const rect = await slider.boundingBox();
  const dpi = await page.evaluate(() => window.devicePixelRatio);
  const origin = native('Probe', {}, 'main');
  native('Raise', {}, 'main');
  native(
    'Drag',
    {
      X: Math.round(origin.clientX + (rect.x + 8) * dpi),
      Y: Math.round(origin.clientY + (rect.y + rect.height / 2) * dpi),
      ToX: Math.round(origin.clientX + (rect.x + rect.width - 8) * dpi),
      ToY: Math.round(origin.clientY + (rect.y + rect.height / 2) * dpi),
    },
    'main',
  );
  const values = await page.evaluate(() => window.__rangeValues);
  assert.ok(
    values.length >= 8,
    `${name} remains interactive throughout a continuous native drag: ${values}`,
  );
  assert.equal(Number(await slider.inputValue()), Number(await slider.getAttribute('max')));
  assert.equal(await slider.isEnabled(), true);
}
try {
  let { main, overlay } = await launch();
  await main.getByRole('button', { name: 'LAN / browser', exact: true }).click();
  assert.equal((await snapshot(main)).recoveryAvailable, true, 'Recovery shortcut registered.');
  await main.getByRole('button', { name: 'Settings', exact: true }).click();
  await dragRange(main, 'Opacity');
  await waitFor(async () => (await snapshot(main)).settings.opacity === 1, 'drag opacity saved');
  assert.equal(native('Probe').alpha, 255);
  await dragRange(main, 'Font size');
  await waitFor(
    async () => (await snapshot(main)).settings.fontSize === 48,
    'drag font size saved',
  );
  console.log(
    'PASS: continuous real mouse drags keep both sliders enabled and save their final value',
  );
  await main.getByRole('button', { name: 'Show overlay' }).click();
  await waitFor(async () => (await snapshot(main)).settings.visible, 'overlay shown');
  assert.equal(native('Probe').visible, true);
  assert.equal(native('Probe').topmost, true);
  assert.equal(await overlay.getByRole('toolbar').count(), 0, 'Overlay has no editor toolbar.');
  const forbidden = await overlay.evaluate(() =>
    window.__TAURI_INTERNALS__
      .invoke('overlay_update', { patch: { opacity: 0.3 } })
      .catch((error) => error),
  );
  assert.equal(forbidden.code, 'FORBIDDEN', 'The overlay cannot change control-panel settings.');
  assert.equal(
    await overlay.locator('.collaboration-carets__caret').count(),
    0,
    'Overlay has no remote cursors.',
  );
  await setRange(main, 'Opacity', 40);
  await waitFor(async () => (await snapshot(main)).settings.opacity === 0.4, 'opacity applied');
  assert.equal(native('Probe').alpha, 102, 'Win32 layered opacity is 40%.');
  await main.getByLabel('Always on top', { exact: true }).click();
  await waitFor(async () => !(await snapshot(main)).settings.alwaysOnTop, 'always-on-top disabled');
  assert.equal(native('Probe').topmost, false);
  assert.equal(native('Probe').alpha, 102, 'Changing topmost preserves opacity.');
  await main.getByLabel('Always on top', { exact: true }).click();
  await waitFor(async () => (await snapshot(main)).settings.alwaysOnTop, 'always-on-top enabled');
  assert.equal(native('Probe').topmost, true);
  assert.equal(native('Probe').alpha, 102, 'Restoring topmost preserves opacity.');
  await setRange(main, 'Font size', 28);
  await waitFor(
    async () =>
      (await overlay
        .locator('.overlay-surface')
        .evaluate((node) => getComputedStyle(node).fontSize)) === '28px',
    'local font size updates',
  );
  console.log('PASS: separate windows, native opacity/topmost, local font size, clean overlay');

  await main.getByRole('button', { name: 'Start session', exact: true }).click();
  await main.getByLabel('Your name').fill('Desktop author');
  await main.getByRole('button', { name: 'Join session', exact: true }).click();
  await waitFor(
    async () =>
      (await main.locator('.app-header [role="status"]').textContent()).trim() === 'Connected',
    'desktop joins host',
  );
  const controlEditor = main.getByRole('textbox', { name: 'Shared document' });
  const overlayEditor = overlay.getByRole('textbox', { name: 'Shared document' });
  await controlEditor.fill('Shared overlay document.');
  await waitFor(
    async () => (await overlayEditor.textContent()) === 'Shared overlay document.',
    'overlay receives shared document',
  );
  guestBrowser = await chromium.launch();
  const guest = await guestBrowser.newPage();
  guest.on('pageerror', (error) => errors.push(error.message));
  await guest.goto(await main.getByLabel('Invitation', { exact: true }).inputValue());
  await guest.getByLabel('Your name').fill('Browser guest');
  await guest.getByRole('button', { name: 'Join session', exact: true }).click();
  const guestEditor = guest.getByRole('textbox', { name: 'Shared document' });
  await waitFor(
    async () => (await guestEditor.textContent()) === 'Shared overlay document.',
    'browser joins desktop document',
  );
  const authorActivity = guest.locator(
    '[data-participant-name="Desktop author"] .participant-activity',
  );
  native('Focus', {}, 'main');
  await controlEditor.press('Control+End');
  await main.keyboard.insertText(' Main view.');
  await waitFor(
    async () => (await authorActivity.textContent()).startsWith('Typing'),
    'control-panel typing presence',
  );
  await waitFor(
    async () =>
      (await overlayEditor.textContent()) === (await guestEditor.textContent()) &&
      (await overlayEditor.textContent()).includes('Main view.'),
    'control-panel edits reach both views',
  );
  native('Focus');
  await overlayEditor.press('Control+End');
  await overlay.keyboard.insertText(' Written in overlay.');
  await waitFor(
    async () => (await authorActivity.textContent()).startsWith('Typing'),
    'overlay typing presence',
  );
  await waitFor(
    async () => (await guestEditor.textContent()).includes('Written in overlay.'),
    'overlay edits reach browser',
  );
  await waitFor(
    async () => (await controlEditor.textContent()) === (await overlayEditor.textContent()),
    'overlay edits reach control panel',
  );
  assert.equal(
    await guest.getByRole('list', { name: 'Participants' }).getByRole('listitem').count(),
    2,
    'Overlay shares the desktop identity, without a ghost participant.',
  );
  await waitFor(
    async () =>
      (await guest.locator('.collaboration-carets__label[data-name="Desktop author"]').count()) ===
      1,
    'overlay cursor reaches browser',
  );
  await overlayEditor.press('Control+a');
  await waitFor(
    async () => (await authorActivity.textContent()) === 'Selecting text',
    'overlay selection activity',
  );
  await waitFor(
    async () =>
      (await guest
        .locator('.collaboration-selection[data-selection-user="Desktop author"]')
        .count()) > 0,
    'overlay selection reaches browser',
  );
  await overlayEditor.press('ArrowRight');
  await Promise.all([overlayEditor.press('Control+End'), guestEditor.press('Control+End')]);
  await Promise.all([
    overlay.keyboard.insertText(' OVERLAY'),
    guest.keyboard.insertText(' BROWSER'),
  ]);
  await waitFor(async () => {
    const text = await controlEditor.textContent();
    return (
      text === (await overlayEditor.textContent()) &&
      text === (await guestEditor.textContent()) &&
      text.includes('OVERLAY') &&
      text.includes('BROWSER')
    );
  }, 'concurrent overlay/browser edits converge');
  await main.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await waitFor(
    async () =>
      (await main.locator('.app-header [role="status"]').textContent()).trim() === 'Disconnected',
    'desktop disconnected',
  );
  await overlayEditor.press('Control+End');
  await overlay.keyboard.insertText(' OFFLINE');
  await guestEditor.press('Control+End');
  await guest.keyboard.insertText(' REMOTE');
  await main.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await waitFor(async () => {
    const text = await controlEditor.textContent();
    return (
      text === (await overlayEditor.textContent()) &&
      text === (await guestEditor.textContent()) &&
      text.includes('OFFLINE') &&
      text.includes('REMOTE')
    );
  }, 'overlay reconnect retains concurrent edits');
  await overlay.screenshot({ path: resolve(directory, 'shared-document-overlay.png') });
  await main.getByRole('button', { name: 'Leave session' }).click();
  await waitFor(async () => (await overlayEditor.count()) === 0, 'leaving clears overlay');
  await main.getByRole('button', { name: 'Join session', exact: true }).click();
  await waitFor(
    async () => (await overlayEditor.textContent()) === (await guestEditor.textContent()),
    'rejoining rebinds overlay',
  );
  await guestBrowser.close();
  guestBrowser = undefined;
  console.log(
    'PASS: shared desktop/overlay/browser editing, one identity, cursor/selection, concurrent edits, disconnect/reconnect, leave/rejoin',
  );

  // Closing the foreground browser can transfer activation to another app.
  // Focus the overlay before sending an OS mouse gesture to its header.
  native('Focus');
  let bounds = native('Probe');
  native('Drag', { X: bounds.x + 50, Y: bounds.y + 22, ToX: bounds.x + 140, ToY: bounds.y + 92 });
  let moved = native('Probe');
  assert.ok(
    moved.x !== bounds.x && moved.y !== bounds.y,
    'Real mouse drag moves the native window.',
  );
  native('Drag', {
    X: moved.x + moved.width - 4,
    Y: moved.y + moved.height - 4,
    ToX: moved.x + moved.width + 86,
    ToY: moved.y + moved.height + 66,
  });
  let resized = native('Probe');
  assert.ok(
    resized.width > moved.width && resized.height > moved.height,
    'Real edge drag resizes the native window.',
  );
  console.log('PASS: real native drag and resize');

  // A separate WinForms process verifies actual compositor blending and cross-app hit testing.
  const clickFile = resolve(directory, 'underlying-click.txt');
  underlay = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      resolve(root, 'scripts/overlay-native.ps1'),
      '-Action',
      'Underlay',
      '-AppProcessId',
      '0',
      '-X',
      '20',
      '-Y',
      '20',
      '-OutputPath',
      clickFile,
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  underlay.stderr.on('data', (data) => process.stderr.write(data));
  await waitFor(() => {
    try {
      return native('Probe', {}, 'main', underlay.pid).visible;
    } catch {
      return false;
    }
  }, 'independent underlying app');
  const surface = native('Probe', {}, 'main', underlay.pid);
  native('Raise', {}, 'main', underlay.pid);
  native('Move', { X: surface.x + 90, Y: surface.y + 70 });
  bounds = native('Probe');
  const point = { X: bounds.x + 8, Y: bounds.y + 65 };
  native('Toggle');
  await waitFor(
    async () => !(await snapshot(main)).settings.visible,
    'hide for compositor baseline',
  );
  const baseline = native('Pixel', point);
  native('Toggle');
  await waitFor(async () => (await snapshot(main)).settings.visible, 'show for compositor check');
  const blend = native('Pixel', point);
  for (const [channel, color] of Object.entries(baseline)) {
    assert.ok(
      Math.abs(blend[channel] - (255 * 0.4 + color * 0.6)) < 12,
      `Native ${channel} channel reflects translucent composition over another app: ${blend[channel]}`,
    );
  }
  native('Capture', { OutputPath: resolve(directory, 'native-overlay-over-app.png') });
  native('Click', point);
  assert.equal(
    await readFile(clickFile, 'utf8').catch(() => ''),
    '',
    'Interactive overlay intercepts the underlying click.',
  );
  // Starting a new session resets the workspace view, while native settings persist.
  const settingsButton = main.getByRole('button', { name: 'Settings', exact: true });
  if ((await settingsButton.getAttribute('aria-expanded')) !== 'true') await settingsButton.click();
  await main.getByLabel('Click-through', { exact: true }).click();
  await waitFor(async () => (await snapshot(main)).settings.clickThrough, 'click-through enabled');
  assert.equal(native('Probe').clickThrough, true);
  assert.equal(native('Probe').alpha, 102, 'Click-through preserves opacity.');
  native('Click', point);
  await waitFor(
    async () => (await readFile(clickFile, 'utf8').catch(() => '')) === 'clicked',
    'click reaches another app through overlay',
  );
  assert.equal(native('Probe', {}, 'main', underlay.pid).foreground, true);
  native('Toggle');
  await waitFor(async () => !(await snapshot(main)).settings.visible, 'hide pass-through overlay');
  native('Toggle');
  await waitFor(async () => (await snapshot(main)).settings.visible, 'show pass-through overlay');
  assert.equal(
    native('Probe', {}, 'main', underlay.pid).foreground,
    true,
    'Showing the overlay preserves the underlying app keyboard focus.',
  );
  native('Recover');
  await waitFor(
    async () => !(await snapshot(main)).settings.clickThrough,
    'real global shortcut restores interaction',
  );
  assert.equal(native('Probe').clickThrough, false);
  assert.equal(native('Probe').alpha, 102, 'Recovery preserves opacity.');
  native('Toggle');
  await waitFor(async () => !(await snapshot(main)).settings.visible, 'overlay hidden by shortcut');
  assert.equal(native('Probe').visible, false);
  native('Toggle');
  await waitFor(async () => (await snapshot(main)).settings.visible, 'overlay shown by shortcut');
  assert.equal(native('Probe').visible, true);
  console.log('PASS: clicks reach the underlying app, global recovery, global hide/show');
  native('Close', {}, 'main', underlay.pid);

  await main.getByRole('button', { name: 'Reset position & size' }).click();
  await waitFor(async () => {
    const value = (await snapshot(main)).settings;
    return value.width === 520 && value.height === 320;
  }, 'reset bounds');
  await setRange(main, 'Opacity', 75);
  bounds = native('Probe');
  native('Drag', { X: bounds.x + 50, Y: bounds.y + 22, ToX: bounds.x + 100, ToY: bounds.y + 72 });
  bounds = native('Probe');
  native('Drag', {
    X: bounds.x + bounds.width - 4,
    Y: bounds.y + bounds.height - 4,
    ToX: bounds.x + bounds.width + 46,
    ToY: bounds.y + bounds.height + 36,
  });
  await main.getByLabel('Always on top', { exact: true }).click();
  await waitFor(
    async () => !(await snapshot(main)).settings.alwaysOnTop,
    'save non-default topmost preference',
  );
  await main.getByLabel('Click-through', { exact: true }).click();
  await waitFor(
    async () => (await snapshot(main)).settings.clickThrough,
    'save click-through preference',
  );
  const before = (await snapshot(main)).settings;
  assert.notEqual(before.x, 80);
  assert.notEqual(before.width, 520);
  await waitFor(async () => {
    try {
      const saved = JSON.parse(await readFile(resolve(directory, 'overlay.json'), 'utf8'));
      return saved.opacity === 0.75 && saved.width === before.width;
    } catch {
      return false;
    }
  }, 'atomic local preferences written');
  await main.screenshot({ path: resolve(directory, 'control-panel.png') });
  native('Capture', { OutputPath: resolve(directory, 'native-overlay.png') });
  await close();
  ({ main, overlay } = await launch());
  const after = (await snapshot(main)).settings;
  for (const field of [
    'x',
    'y',
    'width',
    'height',
    'opacity',
    'fontSize',
    'alwaysOnTop',
    'clickThrough',
    'visible',
  ])
    assert.equal(after[field], before[field], `${field} restored after restart`);
  assert.equal(native('Probe').alpha, 191);
  assert.equal(native('Probe').visible, true);
  assert.equal(native('Probe').topmost, false);
  assert.equal(native('Probe').clickThrough, true);
  native('Recover');
  await waitFor(
    async () => !(await snapshot(main)).settings.clickThrough,
    'recover restored click-through after restart',
  );

  // A second native instance cannot acquire the shortcut already held by the first.
  const conflictDirectory = resolve(directory, 'conflict');
  await mkdir(conflictDirectory);
  await writeFile(
    resolve(conflictDirectory, 'overlay.json'),
    JSON.stringify({ ...before, clickThrough: true, visible: false }),
  );
  conflictingApp = spawn(exe, [], {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      VEIL_TEST_SETTINGS_DIR: conflictDirectory,
      WEBVIEW2_USER_DATA_FOLDER: resolve(conflictDirectory, 'webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        '--remote-debugging-port=9224 --remote-debugging-address=127.0.0.1',
    },
    stdio: 'ignore',
  });
  await waitFor(async () => {
    try {
      return (await fetch('http://127.0.0.1:9224/json/version')).ok;
    } catch {
      return false;
    }
  }, 'shortcut conflict instance');
  conflictingBrowser = await chromium.connectOverCDP('http://127.0.0.1:9224');
  await waitFor(
    () =>
      conflictingBrowser
        .contexts()
        .flatMap((context) => context.pages())
        .some((page) => page.url().includes('?overlay')),
    'second overlay initialized',
  );
  const other = conflictingBrowser
    .contexts()
    .flatMap((context) => context.pages())
    .find((page) => !page.url().includes('?overlay'));
  await other.getByRole('button', { name: 'Settings', exact: true }).click();
  const conflict = await snapshot(other);
  assert.equal(conflict.recoveryAvailable, false);
  assert.equal(
    conflict.settings.clickThrough,
    false,
    'Saved click-through is cleared when recovery is unavailable.',
  );
  assert.equal(await other.getByLabel('Click-through', { exact: true }).isDisabled(), true);
  const rejection = await other.evaluate(() =>
    window.__TAURI_INTERNALS__
      .invoke('overlay_update', { patch: { clickThrough: true } })
      .catch((error) => error),
  );
  assert.equal(rejection.code, 'UNSUPPORTED');
  native('Close', {}, 'main', conflictingApp.pid);
  await waitFor(() => conflictingApp.exitCode !== null, 'conflict instance clean exit');
  await conflictingBrowser.close();
  conflictingBrowser = undefined;
  console.log('PASS: shortcut collision disables click-through in UI and native command');
  await close();
  assert.deepEqual(errors, []);
  console.log(
    `PASS: preferences restored after clean restart; no JavaScript errors\nEvidence: ${directory}`,
  );
} finally {
  if (guestBrowser) await guestBrowser.close();
  if (conflictingApp?.exitCode === null) conflictingApp.kill();
  if (conflictingBrowser) await conflictingBrowser.close();
  if (underlay?.exitCode === null) underlay.kill();
  if (app?.exitCode === null) app.kill();
  if (browser) await browser.close();
}
