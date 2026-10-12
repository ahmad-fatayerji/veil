// Real WebView2 channel selection, persistence and native administration boundary.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

assert.equal(process.platform, 'win32');
const root = resolve(import.meta.dirname, '..');
const currentVersion = JSON.parse(
  await readFile(resolve(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'),
).version;
await mkdir(resolve(root, 'target/update-acceptance'), { recursive: true });
const directory = await mkdtemp(resolve(root, 'target/update-acceptance/run-'));
const endpoint = 'http://127.0.0.1:9236';
let app, browser;
const errors = [];
const certificate = resolve(directory, 'fixture.pem');
const key = resolve(directory, 'fixture.key');
execFileSync(
  'C:/Program Files/Git/usr/bin/openssl.exe',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    key,
    '-out',
    certificate,
    '-days',
    '1',
    '-subj',
    '/CN=127.0.0.1',
    '-addext',
    'subjectAltName=IP:127.0.0.1',
  ],
  { stdio: 'ignore', windowsHide: true },
);
let mode = 'corrupt';
let downloads = 0;
const fixture = createServer(
  { key: await readFile(key), cert: await readFile(certificate) },
  (request, response) => {
    if (request.url === '/feed') {
      if (mode === 'check-throttle') {
        response.writeHead(429, { 'Retry-After': '120' });
        response.end();
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          version: mode === 'current' ? currentVersion : '999.0.0',
          platforms: {
            'windows-x86_64': {
              url: `https://127.0.0.1:${fixture.address().port}/installer`,
              signature: 'invalid',
            },
          },
        }),
      );
      return;
    }
    downloads++;
    if (mode === 'throttle') {
      response.writeHead(429, { 'Retry-After': '3' });
      response.end();
    } else if (mode === 'slow') {
      response.writeHead(200, { 'Content-Length': '1048576' });
      const timer = setInterval(() => response.write(Buffer.alloc(4096)), 100);
      response.on('close', () => clearInterval(timer));
    } else if (mode === 'retry' && downloads === 1) {
      response.writeHead(200, { 'Content-Length': '100' });
      response.write('partial');
      setTimeout(() => response.destroy(), 50);
    } else {
      response.writeHead(200, { 'Content-Length': '7' });
      response.end('corrupt');
    }
  },
);
await new Promise((done) => fixture.listen(0, '127.0.0.1', done));
const fixtureUrl = `https://127.0.0.1:${fixture.address().port}/feed`;
const invoke = (page, command, args) =>
  page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
    command,
    args,
  });
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
      VEIL_TEST_LEGACY: '0',
      VEIL_TEST_SETTINGS_DIR: directory,
      VEIL_TEST_UPDATE_URL: fixtureUrl,
      VEIL_TEST_UPDATE_CA: certificate,
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
  await page.locator('.desktop-updates summary').waitFor({ state: 'attached' });
  if (await page.locator('.desktop-updates summary').isVisible()) {
    await page.locator('.desktop-updates summary').click();
  } else {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('button', { name: 'Updates', exact: true })
      .click();
  }
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
  await writeFile(
    resolve(directory, 'update-receipt.json'),
    JSON.stringify({ fromVersion: '0.1.0', toVersion: currentVersion }),
  );
  let page = await launch();
  await page
    .getByText(`Veil updated successfully from 0.1.0 to ${currentVersion}.`, { exact: true })
    .waitFor();
  await page.screenshot({ path: resolve(directory, 'update-success.png') });
  await page.getByRole('button', { name: 'Dismiss update result' }).click();
  await waitFor(async () => !(await invoke(page, 'update_status')).completion);
  await waitFor(async () => (await invoke(page, 'update_status')).availableVersion === '999.0.0');
  await page.locator('.desktop-settings-button .settings-attention-dot').waitFor();
  assert.equal(
    (await invoke(page, 'update_status')).busy,
    false,
    'Startup check completes without installation',
  );
  await page.getByRole('button', { name: 'Close Settings', exact: true }).click();
  await page.locator('.desktop-settings-button .settings-attention-dot').waitFor();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('heading', { name: 'Updates', exact: true }).waitFor();
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
  assert.equal(
    (await invoke(page, 'update_status')).completion,
    null,
    'Dismissal survives restart',
  );
  assert.equal(await page.getByLabel('Update channel').inputValue(), 'beta');
  await invoke(page, 'overlay_visibility', { visible: true });
  await waitFor(() =>
    browser
      .contexts()
      .flatMap((context) => context.pages())
      .some((item) => item.url().includes('?overlay')),
  );
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
  mode = 'current';
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await waitFor(async () => !(await invoke(page, 'update_status')).availableVersion);
  await page
    .locator('.desktop-settings-button .settings-attention-dot')
    .waitFor({ state: 'detached' });
  for (const fault of ['corrupt', 'retry', 'slow', 'throttle']) {
    mode = fault;
    downloads = 0;
    await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
    await waitFor(async () => (await invoke(page, 'update_status')).availableVersion === '999.0.0');
    await page.getByRole('button', { name: 'Install update and restart', exact: true }).click();
    if (fault === 'slow') {
      await waitFor(async () => (await invoke(page, 'update_status')).progress.downloaded >= 65536);
      const progress = page.getByRole('progressbar', { name: 'Update download progress' });
      await progress.waitFor();
      assert.equal(await progress.getAttribute('max'), '1048576');
      assert.equal(
        await page.locator('[inert]').count(),
        1,
        'Session controls are blocked during download',
      );
      await assert.rejects(
        invoke(page, 'document_relay', {
          message: { kind: 'session', id: 'guard-check', update: [0, 0], user: {} },
        }),
      );
      await page.screenshot({ path: resolve(directory, 'download-progress.png') });
      await page.getByRole('button', { name: 'Cancel download', exact: true }).click();
    }
    await page
      .getByRole('alert')
      .filter({
        hasText:
          fault === 'slow'
            ? 'Update cancelled'
            : fault === 'throttle'
              ? 'GitHub is limiting'
              : 'signature or signed-version',
      })
      .waitFor();
    await waitFor(async () => !(await invoke(page, 'update_status')).busy);
    assert.equal(downloads, fault === 'retry' ? 2 : 1);
    await invoke(page, 'document_relay', {
      message: { kind: 'session', id: 'guard-check', update: [0, 0], user: {} },
    });
    assert.equal(
      (await invoke(page, 'update_status')).sessionActive,
      true,
      'Failure releases native session gate',
    );
    await invoke(page, 'document_relay', { message: { kind: 'closed' } });
    if (fault === 'throttle') {
      assert.equal(
        await page.getByRole('button', { name: 'Check for updates', exact: true }).isDisabled(),
        true,
      );
      await waitFor(() =>
        page.getByRole('button', { name: 'Check for updates', exact: true }).isEnabled(),
      );
    }
    assert.equal(app.exitCode, null, 'Failure never launches an installer or exits Veil');
  }
  mode = 'check-throttle';
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'GitHub is limiting update checks' }).waitFor();
  const cooldown = (await invoke(page, 'update_status')).cooldownUntil;
  assert.ok(
    cooldown > Date.now() / 1000 + 55,
    'Manifest 429 triggers a conservative manual cooldown',
  );
  await assert.rejects(invoke(page, 'update_check'));
  assert.equal(
    (await invoke(page, 'update_status')).availableVersion,
    '999.0.0',
    'Failed refresh preserves the known update',
  );
  await page.locator('.desktop-settings-button .settings-attention-dot').waitFor();
  await close();
  await writeFile(
    resolve(directory, 'update-receipt.json'),
    JSON.stringify({ fromVersion: '0.2.0', toVersion: '999.0.0' }),
  );
  page = await launch();
  await page
    .getByRole('alert')
    .filter({ hasText: 'The update to 999.0.0 did not complete as expected' })
    .waitFor();
  await page.screenshot({ path: resolve(directory, 'update-incomplete.png') });
  assert.deepEqual(errors, []);
  console.log(
    `Native updater acceptance passed: channel persistence, authorization, progress, cancellation, corruption rejection, retries, throttling, session recovery, completion feedback. Evidence: ${directory}`,
  );
} finally {
  await close();
  fixture.closeAllConnections();
  await new Promise((done) => fixture.close(done));
}
