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
const startupOnly = process.argv.includes('--startup-only');
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function waitFor(check, name, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
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
  app = spawn(
    resolve(process.env.VEIL_CAPTURE_TEST_EXE || resolve(root, 'target/debug/veil-desktop.exe')),
    [],
    {
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
    },
  );
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
  const main = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((page) => !page.url().includes('?overlay'));
  await main.evaluate(() => window.__TAURI_INTERNALS__.invoke('app_quit')).catch(() => {});
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
async function capture(mode, phase, held = false) {
  // Keep the known background above unrelated normal windows, below the topmost overlay.
  if (!held) native('Raise', {}, 'main', underlay.pid);
  await delay(200);
  const bounds = native('Probe');
  const imagePath = resolve(directory, `${mode}-${phase}.png`);
  let source =
    mode === 'gdi'
      ? [
          '-f',
          'gdigrab',
          '-draw_mouse',
          '1',
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
          `ddagrab=framerate=5:draw_mouse=1:video_size=${bounds.width}x${bounds.height}:offset_x=${bounds.x}:offset_y=${bounds.y}`,
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
  let borderBlue = 0;
  let borderPixels = 0;
  for (let index = 0; index < pixels.length; index += 3) {
    const [r, g, b] = pixels.subarray(index, index + 3);
    if (r > 220 && g > 200 && b < 140) yellow++;
    // WinForms can shade its button on hover; allow that small color variation.
    const background = Math.abs(r - 25) < 30 && Math.abs(g - 65) < 30 && Math.abs(b - 95) < 30;
    if (background) blue++;
    const pixel = index / 3;
    const x = pixel % bounds.width;
    const y = Math.floor(pixel / bounds.width);
    if (x < 4 || y < 4 || x >= bounds.width - 4 || y >= bounds.height - 4) {
      borderPixels++;
      if (background) borderBlue++;
    }
  }
  const cursor = native('CursorProbe');
  let cursorPixels = 0;
  // The recorded pointer must remain visible on the otherwise plain blue background.
  for (
    let y = Math.max(0, cursor.y - bounds.y);
    y < Math.min(bounds.height, cursor.y - bounds.y + 32);
    y++
  ) {
    for (
      let x = Math.max(0, cursor.x - bounds.x);
      x < Math.min(bounds.width, cursor.x - bounds.x + 32);
      x++
    ) {
      const [r, g, b] = pixels.subarray((y * bounds.width + x) * 3, (y * bounds.width + x) * 3 + 3);
      if (Math.abs(r - 25) >= 30 || Math.abs(g - 65) >= 30 || Math.abs(b - 95) >= 30)
        cursorPixels++;
    }
  }
  return {
    mode,
    phase,
    yellow,
    blue,
    borderBlue,
    borderPixels,
    cursor,
    cursorPixels,
    imagePath,
    bounds,
  };
}

const handles = {
  move: ['Move', 'move'],
  north: ['Resize ↕', 'vertical'],
  south: ['Resize ↕', 'vertical'],
  east: ['Resize ↔', 'horizontal'],
  west: ['Resize ↔', 'horizontal'],
  northEast: ['Resize ↗', 'nesw'],
  southWest: ['Resize ↗', 'nesw'],
  northWest: ['Resize ↘', 'nwse'],
  southEast: ['Resize ↘', 'nwse'],
};
const handleLocator = (overlay, handle) =>
  overlay.locator(handle === 'move' ? '.overlay-drag-handle' : `.overlay-resize-${handle}`);
async function pointAt(overlay, handle) {
  let point;
  native('MovePointer', { X: 5, Y: 5 });
  await waitFor(async () => {
    const box = await handleLocator(overlay, handle).boundingBox();
    const scale = await overlay.evaluate(() => devicePixelRatio);
    const bounds = native('Probe');
    point = {
      X: Math.round(bounds.clientX + (box.x + (handle === 'move' ? 70 : box.width / 2)) * scale),
      Y: Math.round(bounds.clientY + (box.y + box.height / 2) * scale),
    };
    native('MovePointer', point);
    const cursor = native('CursorProbe');
    return cursor.x === point.X && cursor.y === point.Y;
  }, `pointer on ${handle}`);
  return point;
}
function holdPointer(x, y, toX, toY, readyPath) {
  return spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      resolve(root, 'scripts/overlay-native.ps1'),
      '-Action',
      'HoldDrag',
      '-AppProcessId',
      String(app.pid),
      '-X',
      String(x),
      '-Y',
      String(y),
      '-ToX',
      String(toX),
      '-ToY',
      String(toY),
      '-OutputPath',
      readyPath,
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
}
async function pointAtEditor(overlay) {
  let cursor;
  await waitFor(async () => {
    const editor = await overlay.locator('.tiptap').boundingBox();
    const article = await overlay.locator('.overlay-document').boundingBox();
    const left = Math.max(editor.x, article.x);
    const top = Math.max(editor.y, article.y);
    const right = Math.min(editor.x + editor.width, article.x + article.width);
    const bottom = Math.min(editor.y + editor.height, article.y + article.height);
    assert.ok(right > left && bottom > top, 'Editor has a visible area');
    const scale = await overlay.evaluate(() => devicePixelRatio);
    const before = native('Probe');
    native('MovePointer', {
      X: Math.round(before.clientX + (left + Math.min(40, (right - left) / 2)) * scale),
      Y: Math.round(before.clientY + (top + Math.min(10, (bottom - top) / 2)) * scale),
    });
    cursor = native('CursorProbe');
    const bounds = native('Probe');
    return (
      cursor.overTestWindow &&
      (await overlay.evaluate(
        ({ cursor, bounds }) =>
          !!document
            .elementFromPoint(
              (cursor.x - bounds.clientX) / devicePixelRatio,
              (cursor.y - bounds.clientY) / devicePixelRatio,
            )
            ?.closest('.tiptap'),
        { cursor, bounds },
      ))
    );
  }, 'pointer over visible editor');
  return cursor;
}
async function captureGesture(
  mode,
  resize,
  overlay,
  handle = resize ? 'southEast' : 'move',
  finish = 'release',
  label = handle,
) {
  native('Raise', {}, 'main', underlay.pid);
  native('Focus');
  native('Move', { X: 100, Y: 130, Width: 520, Height: 320 });
  await delay(500);
  const before = native('Probe');
  // Stay inside the rounded corner's visible resize handle.
  const { X: x, Y: y } = await pointAt(overlay, handle);
  const phase = `${label}-${finish}`;
  const readyPath = resolve(directory, `${mode}-${phase}.ready`);
  const input = holdPointer(x, y, x + 60, y + 45, readyPath);
  try {
    await waitFor(async () => {
      if (input.exitCode !== null) throw new Error(`HoldDrag exited: ${input.exitCode}`);
      return readFile(readyPath).then(
        () => true,
        () => false,
      );
    }, 'held native gesture');
    const during = native('Probe');
    await waitFor(() => overlay.locator('.is-gesturing').count(), 'active gesture');
    assert.equal(await overlay.locator('.overlay-gesture-hint').textContent(), handles[handle][0]);
    const cursor = native('CursorProbe');
    if (cursor.name !== 'arrow')
      console.log({
        handle,
        cursor,
        during,
        classes: await overlay.locator('.overlay-surface').getAttribute('class'),
      });
    assert.equal(cursor.name, 'arrow', `${handle}: actual Windows arrow during gesture`);
    assert.equal(cursor.visible, true);
    await writeFile(
      resolve(directory, `${mode}-${phase}-bounds.json`),
      JSON.stringify({ before, during }, null, 2),
    );
    assert.ok(
      resize
        ? during.width !== before.width || during.height !== before.height
        : during.x > before.x + 40 && during.y > before.y + 25,
      'Overlay updates before mouse release even with Windows outline-only dragging',
    );
    // Pointer may leave its original handle, but the active badge must win over hover.
    if (!mode) native('MovePointer', { X: during.x + 100, Y: during.y + 100 });
    assert.equal(await overlay.locator('.overlay-gesture-hint').textContent(), handles[handle][0]);
    assert.equal(native('CursorProbe').name, 'arrow', 'Arrow over content during gesture');
    if (label === 'editor') {
      const cursor = await pointAtEditor(overlay);
      assert.equal(cursor.name, 'arrow', 'Actual arrow over editable document during resize');
    }
    if (finish === 'escape') native('Escape');
    if (finish === 'blur') native('Focus', {}, 'main');
    if (finish !== 'release') {
      await waitFor(
        async () => !(await overlay.locator('.is-gesturing').count()),
        `${finish} completion`,
      );
      if (finish === 'escape') {
        const restored = native('Probe');
        for (const key of ['x', 'y', 'width', 'height'])
          assert.equal(restored[key], before[key], 'Escape restores bounds');
      }
    }
    if (!mode) return { handle, finish, before, during, cursor };
    const result = await capture(mode, phase, true);
    const badge = await overlay.locator('.overlay-gesture-hint').boundingBox();
    const scale = await overlay.evaluate(() => devicePixelRatio);
    const badgePixels = ffmpeg([
      '-i',
      result.imagePath,
      '-vf',
      `crop=${Math.floor(badge.width * scale)}:${Math.floor(badge.height * scale)}:${Math.ceil(badge.x * scale)}:${Math.ceil(badge.y * scale)}`,
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      'pipe:1',
    ]);
    let badgeBlue = 0;
    for (let i = 0; i < badgePixels.length; i += 3) {
      const [r, g, b] = badgePixels.subarray(i, i + 3);
      if (Math.abs(r - 25) < 30 && Math.abs(g - 65) < 30 && Math.abs(b - 95) < 30) badgeBlue++;
    }
    result.hintBlueRatio = badgeBlue / (badgePixels.length / 3);
    assert.ok(result.hintBlueRatio > 0.97, `${mode}: local header badge excluded`);
    await writeFile(resolve(directory, `${mode}-${phase}.json`), JSON.stringify(result, null, 2));
    assert.equal(input.exitCode, null, 'Capture completed before mouse release');
    assert.equal(result.bounds.affinity, 0x11);
    assert.ok(result.yellow < 100, `${mode}: card excluded during ${phase}`);
    assert.equal(result.cursor.name, 'arrow');
    assert.ok(result.cursorPixels > 5, `${mode}: captured arrow remains visible`);
    assert.ok(
      result.borderBlue / result.borderPixels > 0.97,
      `${mode}: no captured outline on overlay perimeter during ${phase}`,
    );
    return result;
  } finally {
    await writeFile(`${readyPath}.release`, 'release');
    await waitFor(
      () => input.exitCode !== null,
      'release native gesture and restore system setting',
    );
    assert.equal(input.exitCode, 0);
    await waitFor(
      async () => !(await overlay.locator('.is-gesturing').count()),
      'gesture state cleared',
    );
  }
}

async function cursorAcceptance(main, overlay, recoveryAvailable) {
  const evidence = [];
  native('Focus');
  for (const excluded of [false, true]) {
    await command(main, 'overlay_update', { patch: { captureExclusion: excluded } });
    await waitFor(
      async () => !!(await overlay.locator('.is-capture-excluded').count()) === excluded,
      'cursor preference',
    );
    for (const [handle, [hint, ordinary]] of Object.entries(handles)) {
      native('Focus');
      const point = await pointAt(overlay, handle);
      const cursor = native('CursorProbe');
      if (cursor.name !== (excluded ? 'arrow' : ordinary))
        console.log({
          handle,
          point,
          cursor,
          bounds: native('Probe'),
          hit: await overlay.evaluate(
            ({ point, bounds }) => {
              const node = document.elementFromPoint(
                (point.X - bounds.clientX) / devicePixelRatio,
                (point.Y - bounds.clientY) / devicePixelRatio,
              );
              return { className: node?.className, cursor: node && getComputedStyle(node).cursor };
            },
            { point, bounds: native('Probe') },
          ),
        });
      assert.equal(
        cursor.name,
        excluded ? 'arrow' : ordinary,
        `${handle}: actual Windows hover cursor`,
      );
      assert.equal(cursor.visible, true);
      assert.equal(cursor.overTestWindow, true, 'Pointer belongs to the tested overlay');
      assert.equal(await overlay.locator('.overlay-gesture-hint').count(), excluded ? 1 : 0);
      if (excluded)
        assert.equal(await overlay.locator('.overlay-gesture-hint').textContent(), hint);
      evidence.push({ handle, excluded, cursor });
    }
    console.log(`PASS: actual hover cursors and header hints, exclusion ${excluded}`);
  }
  native('MovePointer', { X: 5, Y: 5 });
  await waitFor(
    async () => !(await overlay.locator('.overlay-gesture-hint').count()),
    'hover exit',
  );
  for (const handle of process.env.VEIL_CAPTURE_GESTURES?.split(',') ?? Object.keys(handles)) {
    evidence.push(await captureGesture(null, handle !== 'move', overlay, handle));
    console.log(`PASS: held ${handle}, active arrow and completion`);
  }
  evidence.push(await captureGesture(null, false, overlay, 'move', 'escape'));
  evidence.push(await captureGesture(null, false, overlay, 'move', 'blur'));
  native('Focus');
  const focusPoint = await pointAt(overlay, 'move');
  native('Click', focusPoint);
  await waitFor(
    async () => !(await overlay.locator('.is-gesturing').count()),
    'focus click gesture finished',
  );
  assert.equal(native('Probe').foreground, true, 'Overlay actually focused before blur');
  assert.equal(
    await overlay.evaluate(() => document.hasFocus()),
    true,
    'WebView actually focused before blur',
  );
  native('Focus', {}, 'main');
  assert.equal(
    native('Probe', {}, 'main').foreground,
    true,
    'Control panel actually receives focus',
  );
  await waitFor(
    async () => !(await overlay.locator('.overlay-gesture-hint').count()),
    'blur clears hover',
  );
  native('Focus');
  await pointAt(overlay, 'move');
  await command(main, 'overlay_visibility', { visible: false });
  await waitFor(
    async () => !(await overlay.locator('.overlay-gesture-hint').count()),
    'hide clears hover',
  );
  await command(main, 'overlay_visibility', { visible: true });
  if (recoveryAvailable) {
    await pointAt(overlay, 'move');
    await command(main, 'overlay_update', { patch: { clickThrough: true } });
    await waitFor(
      async () => !(await overlay.locator('.overlay-gesture-hint').count()),
      'click-through clears hover',
    );
    native('Recover');
    await waitFor(
      async () => !(await snapshot(main)).settings.clickThrough,
      'click-through recovery',
    );
    native('Focus');
    await pointAt(overlay, 'southEast');
    assert.equal(native('CursorProbe').name, 'arrow');
  }
  // Hold in document content, then start a real native gesture outside the React handler.
  // A second gesture from the header must reject with GESTURE_ACTIVE and clear UI state.
  native('Focus');
  native('Move', { X: 100, Y: 130, Width: 520, Height: 320 });
  await delay(300);
  const bounds = native('Probe');
  const readyPath = resolve(directory, 'gesture-error.ready');
  const input = holdPointer(
    bounds.x + 100,
    bounds.y + 100,
    bounds.x + 100,
    bounds.y + 100,
    readyPath,
  );
  try {
    await waitFor(
      () =>
        readFile(readyPath).then(
          () => true,
          () => false,
        ),
      'held error fixture',
    );
    await overlay.evaluate(() => {
      window.__cursorFailureGesture = window.__TAURI_INTERNALS__.invoke('overlay_gesture', {
        direction: null,
      });
    });
    await delay(300);
    await handleLocator(overlay, 'move').dispatchEvent('pointerdown', { button: 0 });
    await waitFor(
      async () =>
        (await overlay.getByRole('alert').allTextContents()).join('').includes('already active'),
      'native gesture rejection',
    );
    assert.equal(await overlay.locator('.is-gesturing').count(), 0);
    evidence.push({ failure: 'GESTURE_ACTIVE', activeStateCleared: true });
  } finally {
    await writeFile(`${readyPath}.release`, 'release');
    await waitFor(() => input.exitCode !== null, 'release error fixture');
    assert.equal(input.exitCode, 0);
    await overlay.evaluate(async () => {
      await window.__cursorFailureGesture;
      delete window.__cursorFailureGesture;
    });
  }
  native('Move', { X: 100, Y: 130, Width: 280, Height: 180 });
  await delay(300);
  await pointAt(overlay, 'northWest');
  const badge = await overlay.locator('.overlay-gesture-hint').boundingBox();
  const header = await overlay.locator('.overlay-drag-handle').boundingBox();
  const content = await overlay.locator('.overlay-document').boundingBox();
  assert.ok(badge.x >= header.x && badge.x + badge.width <= header.x + header.width);
  assert.ok(badge.y + badge.height <= content.y, 'Badge fits the header at minimum window size');
  assert.equal(
    await overlay
      .locator('.overlay-gesture-hint')
      .evaluate((node) => getComputedStyle(node).pointerEvents),
    'none',
  );
  await overlay.screenshot({ path: resolve(directory, 'header-hint-minimum-size.png') });
  native('Move', { X: 100, Y: 130, Width: 520, Height: 320 });
  await delay(300);
  await writeFile(resolve(directory, 'cursor-results.json'), JSON.stringify(evidence, null, 2));
}

try {
  let { main, overlay } = await launch();
  const recoveryAvailable = (await snapshot(main)).recoveryAvailable;
  if (!recoveryAvailable)
    console.log(
      'Recovery shortcut occupied: testing control-panel recovery; global shortcut/click-through activation remain unverified.',
    );
  assert.equal((await snapshot(main)).settings.captureExclusion, true, 'Enabled by default');
  assert.equal((await snapshot(main)).capture.status, 'applied');
  assert.equal((await snapshot(main)).capabilities.captureExclusion, 'supported');
  const checkbox = main.getByLabel('Exclude overlay from compatible captures', { exact: true });
  await main.getByRole('button', { name: 'Capture compatibility test', exact: true }).click();
  await main.getByRole('button', { name: 'Show test card', exact: true }).click();
  await overlay.getByLabel('Capture test card').waitFor();
  const opacitySlider = main.getByRole('slider', { name: /Window opacity/ });
  assert.deepEqual(
    await opacitySlider.evaluate((node) => {
      const style = getComputedStyle(node);
      return [style.paddingLeft, style.paddingRight, style.borderWidth];
    }),
    ['0px', '0px', '0px'],
    'Range track has no text-field padding or border at maximum opacity.',
  );
  // Keep the full overlay crop inside the underlay's client area, below its title bar.
  native('Move', { X: 100, Y: 130 });
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
  await waitFor(
    async () => {
      if (underlay.exitCode !== null) throw new Error(`Underlay exited: ${underlay.exitCode}`);
      return readFile(resolve(directory, 'underlay-click.txt.ready')).then(
        () => true,
        () => false,
      );
    },
    'underlay window ready',
    60000,
  );
  const results = [];
  const modes = ['gdi', 'dxgi'];
  if (process.env.VEIL_TEST_OBS_PORTABLE) modes.push('obs-dxgi', 'obs-wgc');
  async function captureExcluded(phase) {
    for (const mode of modes) {
      const result = await capture(mode, phase);
      results.push(result);
      await writeFile(resolve(directory, 'capture-results.json'), JSON.stringify(results, null, 2));
      assert.equal(result.bounds.affinity, 0x11);
      assert.ok(result.yellow < 100, `${mode}: card excluded during ${phase}`);
      assert.ok(
        result.blue / (result.bounds.width * result.bounds.height) > 0.97,
        `${mode}: underlying app visible without a black box during ${phase}`,
      );
    }
  }
  // Check the default-on path before any off/on transition can repair it (#22).
  await captureExcluded('first-show-default-on');
  await command(main, 'overlay_visibility', { visible: false });
  await command(main, 'overlay_visibility', { visible: true });
  await captureExcluded('reshow-default-on');
  await command(main, 'overlay_update', { patch: { opacity: 1, alwaysOnTop: true } });
  await main.locator('label[for="overlay-opacity"]').screenshot({
    path: resolve(directory, 'opacity-100.png'),
  });
  await captureExcluded('appearance-default-on');
  if (!startupOnly) await cursorAcceptance(main, overlay, recoveryAvailable);
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
    if (!mode.startsWith('obs-') && !startupOnly) {
      results.push(
        await captureGesture(mode, false, overlay),
        await captureGesture(mode, true, overlay),
      );
    }
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
  if (recoveryAvailable && !startupOnly) native('Recover');
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
  // Matching affinity does not prove successful output. Recovery must remain
  // available while native status is applied, and must retain visible exclusion.
  const beforeReapply = native('Probe');
  await main.getByRole('button', { name: 'Reapply setting', exact: true }).click();
  await waitFor(async () => (await snapshot(main)).capture.status === 'applied', 'reapplied');
  assert.equal((await snapshot(main)).settings.visible, true);
  assert.equal((await snapshot(main)).settings.captureExclusion, true);
  const afterReapply = native('Probe');
  assert.equal(afterReapply.affinity, 0x11);
  assert.equal(afterReapply.layered, true, 'Reapply restores the layered alpha surface');
  for (const property of ['x', 'y', 'width', 'height', 'alpha', 'topmost', 'clickThrough'])
    assert.equal(afterReapply[property], beforeReapply[property], `Reapply preserves ${property}`);
  await captureExcluded('explicit-reapply');
  await main.screenshot({ path: resolve(directory, 'control-panel.png'), fullPage: true });
  await command(main, 'overlay_capture_test', { enabled: false });
  await main.getByRole('button', { name: 'Close Settings', exact: true }).click();
  await main.getByRole('button', { name: 'Create document', exact: true }).click();
  await overlay.locator('.tiptap').waitFor();
  for (const excluded of [true, false]) {
    await command(main, 'overlay_update', { patch: { captureExclusion: excluded, opacity: 1 } });
    await overlay.locator('.tiptap').fill(`Editing works with exclusion ${excluded}.`);
    if (excluded && !startupOnly)
      await captureGesture(null, true, overlay, 'southEast', 'release', 'editor');
    await waitFor(
      async () => (await main.locator('.tiptap').textContent())?.includes(`exclusion ${excluded}`),
      'overlay editing sync',
    );
    if (!startupOnly) {
      native('Focus');
      assert.equal(
        (await pointAtEditor(overlay)).name,
        'text',
        'Idle editing retains actual Windows text cursor',
      );
    }
  }
  await command(main, 'overlay_update', { patch: { captureExclusion: true } });
  await main.getByRole('button', { name: 'Close document', exact: true }).click();
  await main
    .getByRole('dialog', { name: 'Close document?', exact: true })
    .getByRole('button', { name: 'Close document', exact: true })
    .click();
  await close();
  ({ main, overlay } = await launch());
  assert.equal((await snapshot(main)).settings.captureExclusion, true);
  assert.equal((await snapshot(main)).capture.status, 'applied');
  assert.equal((await snapshot(main)).captureTest, false, 'Test card not persisted');
  assert.equal(native('Probe').affinity, 0x11);
  await command(main, 'overlay_capture_test', { enabled: true });
  await overlay.getByLabel('Capture test card').waitFor();
  await captureExcluded('restart-saved-on');
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
        globalShortcutAndClickThroughVerified: recoveryAvailable && !startupOnly,
        startupOnly,
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
