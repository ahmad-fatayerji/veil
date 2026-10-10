// Actual Windows/WebView2 and desktop capture, with isolated preferences and no session.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from '@playwright/test';
import { recordObs } from './capture-obs.mjs';

assert.equal(process.platform, 'win32');
const root = resolve(import.meta.dirname, '..');
await mkdir(resolve(root, 'target/capture-acceptance'), { recursive: true });
const directory = await mkdtemp(resolve(root, 'target/capture-acceptance/run-'));
const endpoint = 'http://127.0.0.1:9225';
await new Promise((done, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(9225, '127.0.0.1', () => server.close(done));
});
let app;
let browser;
let underlay;
const errors = [];
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function waitFor(check, name) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await delay(150);
  }
  throw new Error(`Timed out: ${name}`);
}
function native(action, args = {}, window = 'overlay', processId = app.pid) {
  const output = execFileSync(
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
      ...Object.entries(args).flatMap(([key, value]) => [`-${key}`, String(value)]),
    ],
    { windowsHide: true, encoding: 'utf8' },
  ).trim();
  return output ? JSON.parse(output) : undefined;
}
async function launch() {
  app = spawn(resolve(root, 'target/debug/veil-desktop.exe'), [], {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      VEIL_TEST_SETTINGS_DIR: directory,
      WEBVIEW2_USER_DATA_FOLDER: resolve(directory, 'webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        '--remote-debugging-port=9225 --remote-debugging-address=127.0.0.1',
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
  }, 'debug endpoint');
  browser = await chromium.connectOverCDP(endpoint);
  await waitFor(
    () =>
      browser
        .contexts()
        .flatMap((context) => context.pages())
        .some((page) => page.url().includes('?overlay')),
    'overlay',
  );
  const pages = browser.contexts().flatMap((context) => context.pages());
  pages.forEach((page) => page.on('pageerror', (error) => errors.push(error.message)));
  const main = pages.find((page) => !page.url().includes('?overlay'));
  const overlay = pages.find((page) => page.url().includes('?overlay'));
  await main.getByRole('button', { name: 'Settings', exact: true }).click();
  await main
    .getByRole('navigation', { name: 'Settings sections' })
    .getByRole('button', { name: 'Overlay', exact: true })
    .click();
  return { main, overlay };
}
async function command(page, name, args) {
  const result = await page.evaluate(
    async ({ name, args }) => {
      try {
        return { value: await window.__TAURI_INTERNALS__.invoke(name, args) };
      } catch (error) {
        return { error };
      }
    },
    { name, args },
  );
  if (result.error) throw result.error;
  return result.value;
}
const snapshot = (page) => command(page, 'overlay_snapshot');
async function close() {
  native('Close', {}, 'main');
  await waitFor(() => app.exitCode !== null, 'clean exit');
  await browser.close();
  browser = undefined;
}
function ffmpeg(args) {
  return execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024,
  });
}
async function capture(mode, phase) {
  // Keep the known background above unrelated normal windows, below the topmost overlay.
  native('Raise', {}, 'main', underlay.pid);
  await delay(200);
  const bounds = native('Probe');
  const imagePath = resolve(directory, `${mode}-${phase}.png`);
  let source =
    mode === 'gdi'
      ? [
          '-f',
          'gdigrab',
          '-framerate',
          '5',
          '-offset_x',
          String(bounds.x),
          '-offset_y',
          String(bounds.y),
          '-video_size',
          `${bounds.width}x${bounds.height}`,
          '-i',
          'desktop',
        ]
      : [
          '-f',
          'lavfi',
          '-i',
          `ddagrab=framerate=5:draw_mouse=0:video_size=${bounds.width}x${bounds.height}:offset_x=${bounds.x}:offset_y=${bounds.y}`,
          '-vf',
          'hwdownload,format=bgra',
        ];
  if (mode.startsWith('obs-')) {
    const recording = await recordObs(
      resolve(process.env.VEIL_TEST_OBS_PORTABLE),
      directory,
      mode.slice(4),
      phase,
      bounds,
    );
    source = ['-ss', '1', '-i', recording];
  }
  ffmpeg([...source, '-frames:v', '1', imagePath]);
  const pixels = ffmpeg(['-i', imagePath, '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
  let yellow = 0;
  let blue = 0;
  for (let index = 0; index < pixels.length; index += 3) {
    const [r, g, b] = pixels.subarray(index, index + 3);
    if (r > 220 && g > 200 && b < 140) yellow++;
    // WinForms can shade its button on hover; allow that small color variation.
    if (Math.abs(r - 25) < 30 && Math.abs(g - 65) < 30 && Math.abs(b - 95) < 30) blue++;
  }
  return { mode, phase, yellow, blue, imagePath, bounds };
}

try {
  let { main, overlay } = await launch();
  const recoveryAvailable = (await snapshot(main)).recoveryAvailable;
  if (!recoveryAvailable)
    console.log(
      'Recovery shortcut occupied: testing control-panel recovery; global shortcut/click-through activation remain unverified.',
    );
  assert.equal((await snapshot(main)).settings.captureExclusion, false, 'Opt-in by default');
  assert.equal((await snapshot(main)).capture.status, 'disabled');
  assert.equal((await snapshot(main)).capabilities.captureExclusion, 'supported');
  const checkbox = main.getByLabel('Exclude overlay from compatible captures', { exact: true });
  await main.getByRole('button', { name: 'Capture compatibility test', exact: true }).click();
  await main.getByRole('button', { name: 'Show test card', exact: true }).click();
  await overlay.getByLabel('Capture test card').waitFor();
  await command(main, 'overlay_update', { patch: { opacity: 1, alwaysOnTop: true } });
  native('Move', { X: 100, Y: 100 });
  native('Move', { X: 900, Y: 100 }, 'main');
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
      String(app.pid),
      '-X',
      '80',
      '-Y',
      '80',
      '-OutputPath',
      resolve(directory, 'underlay-click.txt'),
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  await delay(1500);
  const results = [];
  const modes = ['gdi', 'dxgi'];
  if (process.env.VEIL_TEST_OBS_PORTABLE) modes.push('obs-dxgi', 'obs-wgc');
  for (const mode of modes) {
    if (await checkbox.isChecked()) await checkbox.click();
    await waitFor(async () => (await snapshot(main)).capture.status === 'disabled', 'disabled');
    await delay(300);
    const off = await capture(mode, 'off');
    assert.ok(off.yellow > 10000, `${mode}: test card visible in baseline`);
    await checkbox.click();
    await waitFor(async () => (await snapshot(main)).capture.status === 'applied', 'applied');
    assert.equal(native('Probe').affinity, 0x11);
    await delay(300);
    const on = await capture(mode, 'on');
    assert.ok(on.yellow < 100, `${mode}: card excluded in captured output`);
    assert.ok(on.blue > 10000, `${mode}: underlying app captured, not a black overlay`);
    results.push(off, on);
    await writeFile(resolve(directory, 'capture-results.json'), JSON.stringify(results, null, 2));
  }
  // Appearance changes, click-through and recovery must preserve affinity.
  const appearancePatches = [
    { opacity: 0.75 },
    { alwaysOnTop: false },
    { alwaysOnTop: true },
    { clickThrough: false },
  ];
  if (recoveryAvailable) appearancePatches.push({ clickThrough: true }, { clickThrough: false });
  // With a collision, click-through patches are intentionally rejected by the native guard.
  for (const patch of appearancePatches.filter(
    (patch) => recoveryAvailable || !('clickThrough' in patch),
  )) {
    await command(main, 'overlay_update', { patch });
    assert.equal(native('Probe').affinity, 0x11);
    assert.equal((await snapshot(main)).capture.status, 'applied');
  }
  await command(main, 'overlay_visibility', { visible: false });
  await command(main, 'overlay_visibility', { visible: true });
  if (recoveryAvailable) native('Recover');
  else await command(main, 'overlay_recover');
  await waitFor(async () => (await snapshot(main)).settings.visible, 'recovered');
  assert.equal(native('Probe').affinity, 0x11);
  const mainProbe = native('Probe', {}, 'main');
  assert.ok(!mainProbe.affinityRead || mainProbe.affinity === 0, 'Control panel never excluded');
  for (const [name, args] of [
    ['overlay_update', { patch: { captureExclusion: false } }],
    ['overlay_capture_test', { enabled: false }],
    ['overlay_capture_check', {}],
  ]) {
    const failure = await command(overlay, name, args).catch((error) => error);
    assert.equal(failure.code, 'FORBIDDEN');
  }
  await main.getByRole('button', { name: 'Recheck native setting' }).click();
  assert.equal((await snapshot(main)).capture.status, 'applied');
  await main.screenshot({ path: resolve(directory, 'control-panel.png'), fullPage: true });
  await close();
  ({ main, overlay } = await launch());
  assert.equal((await snapshot(main)).settings.captureExclusion, true);
  assert.equal((await snapshot(main)).capture.status, 'applied');
  assert.equal((await snapshot(main)).captureTest, false, 'Test card not persisted');
  assert.equal(native('Probe').affinity, 0x11);
  await main.getByLabel('Exclude overlay from compatible captures', { exact: true }).click();
  await waitFor(
    async () => (await snapshot(main)).capture.status === 'disabled',
    'disable after restart',
  );
  assert.equal(native('Probe').affinity, 0);
  await close();
  assert.equal(
    JSON.parse(await readFile(resolve(directory, 'overlay.json'), 'utf8')).captureExclusion,
    false,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(directory, 'results.json'),
    JSON.stringify(
      {
        windows: execFileSync(
          'powershell.exe',
          ['-NoProfile', '-Command', '(Get-CimInstance Win32_OperatingSystem).Version'],
          { encoding: 'utf8', windowsHide: true },
        ).trim(),
        ffmpeg: execFileSync('ffmpeg', ['-version'], { encoding: 'utf8', windowsHide: true }).split(
          '\n',
        )[0],
        results,
        globalShortcutAndClickThroughVerified: recoveryAvailable,
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS: capture output, affinity, authorization, style changes and preference restart.\nEvidence: ${directory}`,
  );
} finally {
  if (underlay?.exitCode === null) underlay.kill();
  if (app?.exitCode === null) app.kill();
  if (browser) await browser.close();
}
