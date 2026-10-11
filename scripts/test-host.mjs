// Real Tauri/WebView2 hosting acceptance; uses the bundled browser client.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

assert.equal(process.platform, 'win32', 'Native hosting acceptance requires Windows.');
const root = resolve(import.meta.dirname, '..');
await mkdir(resolve(root, 'target/host-acceptance'), { recursive: true });
const directory = await mkdtemp(resolve(root, 'target/host-acceptance/run-'));
const endpoint = 'http://127.0.0.1:9225';
let app;
let native;
let browser;
const errors = [];
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function waitFor(check, message) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(150);
  }
  throw new Error(`Timed out: ${message}`);
}
async function join(page, invitation, name) {
  await page.goto(invitation);
  assert.equal(new URL(page.url()).hash, '', 'Invitation cleared from browser history.');
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Join session', exact: true }).click();
  await page.getByRole('textbox', { name: 'Shared document' }).waitFor();
  await waitFor(
    async () => (await page.getByRole('status').textContent()) === 'Connected',
    'authenticated sync',
  );
}
try {
  assert.equal(
    await fetch(`${endpoint}/json/version`).catch(() => null),
    null,
    'Port 9225 must be free.',
  );
  app = spawn(resolve(root, 'target/debug/veil-desktop.exe'), [], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      VEIL_TEST_LEGACY: '1',
      VEIL_TEST_SETTINGS_DIR: directory,
      WEBVIEW2_USER_DATA_FOLDER: resolve(directory, 'webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        '--remote-debugging-port=9225 --remote-debugging-address=127.0.0.1',
    },
  });
  app.stderr.on('data', (bytes) => process.stderr.write(bytes));
  await waitFor(
    async () => (await fetch(`${endpoint}/json/version`).catch(() => null))?.ok,
    'native WebView2',
  );
  native = await chromium.connectOverCDP(endpoint);
  await waitFor(
    () =>
      native
        .contexts()
        .flatMap((c) => c.pages())
        .some((p) => !p.url().includes('?overlay')),
    'control panel',
  );
  const main = native
    .contexts()
    .flatMap((c) => c.pages())
    .find((p) => !p.url().includes('?overlay'));
  main.on('pageerror', (error) => errors.push(error.message));
  await main.getByRole('button', { name: 'LAN / browser', exact: true }).click();
  await waitFor(
    () => main.getByRole('button', { name: 'Start session', exact: true }).isEnabled(),
    'host controls ready',
  );
  // An occupied port must fail cleanly and allow retry.
  const { createServer } = await import('node:net');
  const occupied = createServer();
  await new Promise((done, reject) => {
    occupied.once('error', reject);
    occupied.listen(0, '127.0.0.1', done);
  });
  await main.getByLabel('Port', { exact: true }).fill(String(occupied.address().port));
  await main.getByRole('button', { name: 'Start session', exact: true }).click();
  await waitFor(
    async () =>
      (await main.getByRole('alert').textContent()).includes('Cannot start local listener'),
    'bind failure displayed',
  );
  await new Promise((done) => occupied.close(done));
  await main.getByLabel('Port', { exact: true }).fill('4445');
  await main.getByRole('button', { name: 'Start session', exact: true }).click();
  await main.getByLabel('Invitation', { exact: true }).waitFor();
  const invitation = await main.getByLabel('Invitation', { exact: true }).inputValue();
  const original = new URL(invitation);
  const credential = new URLSearchParams(original.hash.slice(1));
  const hostUrl = original.origin;
  assert.equal(hostUrl, 'http://127.0.0.1:4445');
  assert.equal((await fetch(`${hostUrl}/bootstrap`)).status, 404);
  const html = await fetch(hostUrl).then((r) => r.text());
  assert.ok(html.includes('/assets/'), 'Host serves production assets.');
  assert.ok(!html.includes(credential.get('invite')), 'Assets do not reveal invitations.');
  await main.getByLabel('Your name').fill('Host');
  await main.getByRole('button', { name: 'Join session', exact: true }).click();
  const hostEditor = main.getByRole('textbox', { name: 'Shared document' });
  await hostEditor.fill('From the desktop.');
  browser = await chromium.launch();
  const first = await browser.newPage();
  const second = await browser.newPage();
  for (const page of [first, second]) page.on('pageerror', (error) => errors.push(error.message));
  await join(first, invitation, 'Browser one');
  const guestEditor = first.getByRole('textbox', { name: 'Shared document' });
  await waitFor(
    async () => (await guestEditor.textContent()) === 'From the desktop.',
    'desktop to browser updates',
  );
  await guestEditor.fill('From the browser.');
  await waitFor(
    async () => (await hostEditor.textContent()) === 'From the browser.',
    'browser to desktop updates',
  );
  await join(second, invitation, 'Browser two');
  await waitFor(
    async () =>
      (await main.getByRole('list', { name: 'Participants' }).getByRole('listitem').count()) === 3,
    'connected user list',
  );
  assert.equal(
    await first.evaluate(
      async ({ id }) => {
        const response = await fetch('/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: id, token: '0'.repeat(64) }),
        });
        return response.status;
      },
      { id: credential.get('session') },
    ),
    401,
  );
  assert.equal(
    await first.evaluate(
      ({ id }) =>
        new Promise((done) => {
          const socket = new WebSocket(`${location.origin.replace('http:', 'ws:')}/ws/${id}`, [
            'veil.v1',
            `veil.auth.${'0'.repeat(64)}`,
          ]);
          const timer = setTimeout(() => {
            socket.close();
            done(false);
          }, 5000);
          socket.onopen = () => {
            clearTimeout(timer);
            socket.close();
            done(false);
          };
          socket.onerror = () => {
            clearTimeout(timer);
            done(true);
          };
        }),
      { id: credential.get('session') },
    ),
    true,
    'Unauthenticated WebSockets rejected.',
  );
  await second.getByRole('button', { name: 'Leave session' }).click();
  await second
    .getByRole('dialog', { name: 'Leave session?' })
    .getByRole('button', { name: 'Leave session', exact: true })
    .click();
  await waitFor(
    async () =>
      (await main.getByRole('list', { name: 'Participants' }).getByRole('listitem').count()) === 2,
    'leave removes presence',
  );
  // Screenshots omit the secret invitation field.
  await main.getByLabel('Invitation', { exact: true }).evaluate((input) => {
    input.style.visibility = 'hidden';
  });
  await main.screenshot({ path: resolve(directory, 'hosting.png'), fullPage: true });
  await first.screenshot({ path: resolve(directory, 'browser.png'), fullPage: true });
  await main.getByRole('button', { name: 'End session' }).click();
  await main.getByRole('button', { name: 'Start session', exact: true }).waitFor();
  await waitFor(
    async () => (await first.getByRole('status').textContent()) === 'Disconnected',
    'stop closes active WebSockets',
  );
  await waitFor(async () => !(await fetch(hostUrl).catch(() => null)), 'stop releases listener');
  await main.getByRole('button', { name: 'Start session', exact: true }).click();
  await main.getByLabel('Invitation', { exact: true }).waitFor();
  const replacement = await main.getByLabel('Invitation', { exact: true }).inputValue();
  assert.notEqual(replacement, invitation, 'Restart rotates session and invite.');
  assert.equal(
    await first.evaluate(
      async ({ id, token }) =>
        (
          await fetch('/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: id, token }),
          })
        ).status,
      { id: credential.get('session'), token: credential.get('invite') },
    ),
    401,
    'Old invitation revoked by session end.',
  );
  await main.getByRole('button', { name: 'End session' }).click();
  await main.getByRole('button', { name: 'Start session', exact: true }).waitFor();
  if (process.env.VEIL_TEST_LAN_ADDRESS) {
    await main.getByRole('combobox', { name: /^Access/ }).selectOption('lan');
    await main.getByLabel('LAN IPv4 address').fill(process.env.VEIL_TEST_LAN_ADDRESS);
    assert.equal(
      await main.getByRole('button', { name: 'Start session', exact: true }).isEnabled(),
      false,
      'LAN requires explicit acknowledgement.',
    );
    await main.getByRole('checkbox', { name: /I trust this network/ }).check();
    await main.getByRole('button', { name: 'Start session', exact: true }).click();
    await main.getByLabel('Invitation', { exact: true }).waitFor();
    const lanInvitation = await main.getByLabel('Invitation', { exact: true }).inputValue();
    const lanGuest = await browser.newPage();
    await join(lanGuest, lanInvitation, 'LAN route');
    await lanGuest
      .getByRole('textbox', { name: 'Shared document' })
      .fill('Private interface works.');
    await main.getByLabel('Your name').fill('LAN host');
    await main.getByRole('button', { name: 'Join session', exact: true }).click();
    await waitFor(
      async () =>
        (await main.getByRole('textbox', { name: 'Shared document' }).textContent()) ===
        'Private interface works.',
      'private-interface browser to loopback desktop sync',
    );
    await main.getByRole('button', { name: 'End session' }).click();
    console.log(
      'Private IPv4 interface smoke test passed on this PC; a second physical device remains manual.',
    );
  }
  assert.deepEqual(errors, []);
  console.log(`Native hosting acceptance passed. Screenshots: ${directory}`);
} finally {
  if (browser) await browser.close();
  if (native) await native.close();
  if (app?.exitCode === null) app.kill();
}
