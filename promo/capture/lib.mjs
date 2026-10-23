// Drives real Veil desktop instances for promo capture, following the app repo's
// scripts/test-create-share-join.mjs harness: disposable profiles, a loopback-only
// server, and Playwright attached to each WebView2 over CDP.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { link, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

export const appRoot = resolve(import.meta.dirname, '../..');
export const desktopBinary =
  process.env.VEIL_DESKTOP_BINARY ||
  resolve(appRoot, 'target/multi-instance/build/debug/veil-desktop.exe');
export const serverBinary = process.env.VEIL_SERVER_BINARY;

const children = [];
const browsers = [];

export async function unusedPort() {
  const listener = createServer();
  await new Promise((done, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', done);
  });
  const { port } = listener.address();
  await new Promise((done) => listener.close(done));
  return port;
}

export async function waitFor(check, label, timeout = 30_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await check().catch(() => false)) return;
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error(`Timed out: ${label}`);
}

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function launch(file, args, env) {
  const child = spawn(file, args, { env, windowsHide: true, stdio: 'ignore' });
  children.push(child);
  return child;
}

export async function runDirectory() {
  const base = resolve(import.meta.dirname, 'run');
  await mkdir(base, { recursive: true });
  return mkdtemp(resolve(base, 'session-'));
}

export async function startServer(directory) {
  if (!serverBinary) throw new Error('Set VEIL_SERVER_BINARY to a built veil-server.exe');
  const port = await unusedPort();
  const url = `http://127.0.0.1:${port}`;
  await writeFile(resolve(directory, 'turn-secret'), randomBytes(32).toString('hex'));
  await writeFile(resolve(directory, 'metrics-secret'), randomBytes(32).toString('hex'));
  const env = {
    ...process.env,
    HOST_DB: resolve(directory, 'hosts.sqlite'),
    TURN_SECRET_FILE: resolve(directory, 'turn-secret'),
    METRICS_SECRET_FILE: resolve(directory, 'metrics-secret'),
    STUN_URLS: 'stun:127.0.0.1:3479',
    TURN_URLS: 'turn:127.0.0.1:3479',
    LISTEN: `127.0.0.1:${port}`,
  };
  const credential = execFileSync(serverBinary, ['issue', 'promo-capture'], {
    env,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
  launch(serverBinary, [], env);
  await waitFor(async () => (await fetch(`${url}/health`))?.ok, 'server');
  return { url, credential };
}

const pages = (browser) => browser.contexts().flatMap((context) => context.pages());

export async function startApp(directory, name) {
  const profile = resolve(directory, `app-${name}`);
  await mkdir(profile);
  const debugPort = await unusedPort();
  const endpoint = `http://127.0.0.1:${debugPort}`;
  launch(desktopBinary, [], {
    ...process.env,
    VEIL_TEST_SETTINGS_DIR: profile,
    WEBVIEW2_USER_DATA_FOLDER: resolve(profile, 'webview'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
  });
  await waitFor(async () => (await fetch(`${endpoint}/json/version`))?.ok, 'WebView2');
  const browser = await chromium.connectOverCDP(endpoint);
  browsers.push(browser);
  await waitFor(
    async () => pages(browser).some((page) => !page.url().includes('?overlay')),
    'main window',
  );
  const page = pages(browser).find((page) => !page.url().includes('?overlay'));
  await page.getByRole('button', { name: 'Settings', exact: true }).waitFor();
  return { browser, page, overlay: () => pages(browser).find((p) => p.url().includes('?overlay')) };
}

export const invoke = (page, command, args) =>
  page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
    command,
    args,
  });

// Renders the WebView at a fixed CSS size and 2x density for crisp video frames.
export async function frame(page, width, height, scale = 2) {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: scale,
    mobile: false,
  });
  return session;
}

// Records CDP screencast frames with their timestamps; stop() returns the list.
export async function record(page, directory, label) {
  const session = await page.context().newCDPSession(page);
  const out = resolve(directory, 'frames', label);
  await mkdir(out, { recursive: true });
  const frames = [];
  const writes = [];
  session.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = resolve(out, `${String(frames.length).padStart(5, '0')}.jpg`);
    frames.push({ file, time: metadata.timestamp });
    writes.push(writeFile(file, Buffer.from(data, 'base64')));
    session.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  // Without a max size, screencast frames are downscaled to CSS pixels.
  await session.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 92,
    everyNthFrame: 1,
    maxWidth: 4096,
    maxHeight: 4096,
  });
  const started = Date.now() / 1000;
  return {
    async stop() {
      const ended = Date.now() / 1000;
      await session.send('Page.stopScreencast');
      await Promise.all(writes);
      return { out, frames, started, ended };
    },
  };
}

// Encodes timestamped screencast frames to a constant-frame-rate MP4.
export async function encode({ out, frames, started, ended }, target, fps = 30) {
  if (!frames.length) throw new Error(`No frames for ${target}`);
  // Frame timestamps use the browser clock; anchor the first frame to the wall-clock start
  // so logged events (wall clock, relative to `started`) line up with video time.
  const base = frames[0].time;
  const timed = frames.map((entry) => ({ file: entry.file, at: entry.time - base }));
  await writeFile(
    resolve(out, 'timing.json'),
    JSON.stringify({ total: ended - started, frames: timed }),
  );
  await encodeTimed(out, timed, ended - started, target, fps);
}

// Resamples to exactly `fps`: each output tick shows the latest frame captured by then.
export async function encodeTimed(out, timed, total, target, fps = 30) {
  const sequence = resolve(out, 'sequence');
  await rm(sequence, { recursive: true, force: true });
  await mkdir(sequence);
  let source = 0;
  const count = Math.max(1, Math.round(total * fps));
  for (let index = 0; index < count; index++) {
    while (source + 1 < timed.length && timed[source + 1].at <= index / fps) source++;
    await link(timed[source].file, resolve(sequence, `${String(index).padStart(5, '0')}.jpg`));
  }
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-framerate',
      String(fps),
      '-i',
      resolve(sequence, '%05d.jpg'),
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
      '-c:v',
      'libx264',
      '-crf',
      '16',
      '-preset',
      'slow',
      '-movflags',
      '+faststart',
      target,
    ],
    { stdio: 'inherit' },
  );
}

export async function shutdown() {
  for (const browser of browsers) await browser.close().catch(() => {});
  for (const child of children) {
    if (child.pid && child.exitCode === null) {
      try {
        execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        child.kill();
      }
    }
  }
}
