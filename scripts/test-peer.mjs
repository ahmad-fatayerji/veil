// Actual Windows desktop peers, with no signaling, STUN, TURN, or HTTP session server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

assert.equal(process.platform, 'win32');
const root = resolve(import.meta.dirname, '..');
await mkdir(resolve(root, 'target/peer-acceptance'), { recursive: true });
const directory = await mkdtemp(resolve(root, 'target/peer-acceptance/run-'));
const instances = [];
const errors = [];
async function waitFor(check, label) {
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error(`Timed out: ${label}`);
}
async function launch(index) {
  const port = 9231 + index;
  const endpoint = `http://127.0.0.1:${port}`;
  assert.equal(await fetch(`${endpoint}/json/version`).catch(() => null), null);
  const app = spawn(resolve(root, 'target/debug/veil-desktop.exe'), [], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      VEIL_TEST_SETTINGS_DIR: resolve(directory, String(index)),
      WEBVIEW2_USER_DATA_FOLDER: resolve(directory, String(index), 'webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
    },
  });
  const instance = { app, browser: null };
  instances.push(instance);
  app.stderr.on('data', (bytes) => process.stderr.write(bytes));
  await waitFor(
    async () => (await fetch(`${endpoint}/json/version`).catch(() => null))?.ok,
    'WebView2 launch',
  );
  instance.browser = await chromium.connectOverCDP(endpoint);
  const pages = () => instance.browser.contexts().flatMap((context) => context.pages());
  await waitFor(() => pages().some((page) => !page.url().includes('?overlay')), 'main window');
  const page = pages().find((page) => !page.url().includes('?overlay'));
  page.on('pageerror', (error) => errors.push(error.message));
  await page
    .getByLabel('Your name', { exact: true })
    .fill(index === 0 ? 'Host' : `Friend ${index}`);
  return page;
}
const editor = (page) => page.getByRole('textbox', { name: 'Shared document' });
async function connect(host, guest) {
  await host.getByRole('button', { name: 'Generate invitation', exact: true }).click();
  const invitation = host.getByLabel('Peer invitation', { exact: true });
  await waitFor(
    async () => (await invitation.inputValue()).startsWith('veil-p2p:v1:'),
    'offer ICE gathering',
  );
  const code = await invitation.inputValue();
  await guest.getByLabel('Host invitation', { exact: true }).fill(code);
  await guest
    .getByRole('button', { name: /^(Create response|Respond to fresh invitation)$/ })
    .click();
  const response = guest.getByLabel('Peer response', { exact: true });
  await waitFor(
    async () => (await response.inputValue()).startsWith('veil-p2p:v1:'),
    'answer ICE gathering',
  );
  const responseCode = await response.inputValue();
  const payload = JSON.parse(
    Buffer.from(responseCode.slice('veil-p2p:v1:'.length), 'base64url').toString(),
  );
  payload.invite = payload.invite === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
  await host
    .getByLabel("2. Paste your friend's response", { exact: true })
    .fill(`veil-p2p:v1:${Buffer.from(JSON.stringify(payload)).toString('base64url')}`);
  await host.getByRole('button', { name: 'Connect friend', exact: true }).click();
  await waitFor(
    async () => (await host.getByRole('alert').textContent()).includes('does not match'),
    'wrong credential rejected',
  );
  await host
    .getByLabel("2. Paste your friend's response", { exact: true })
    .fill(await response.inputValue());
  await host.getByRole('button', { name: 'Connect friend', exact: true }).click();
  await waitFor(
    async () => (await guest.locator('.app-header [role="status"]').textContent()) === 'Connected',
    'authenticated peer sync',
  );
  return code;
}
try {
  const host = await launch(0);
  await host.getByRole('button', { name: 'Start peer session', exact: true }).click();
  await editor(host).fill('Host document.');
  const guest = await launch(1);
  const code = await connect(host, guest);
  await waitFor(
    async () => (await editor(guest).textContent()) === 'Host document.',
    'initial sync',
  );
  await editor(guest).fill('Friend document.');
  await waitFor(
    async () => (await editor(host).textContent()) === 'Friend document.',
    'guest edits',
  );
  await waitFor(
    async () => (await host.locator('.peer-connections').textContent()).includes('direct'),
    'actual selected direct path',
  );
  // A fresh invitation adds a participant without disrupting the existing connection.
  const third = await launch(2);
  await connect(host, third);
  await waitFor(
    async () => (await editor(third).textContent()) === 'Friend document.',
    'late join',
  );
  await editor(third).fill('Three native peers.');
  await waitFor(
    async () => (await editor(guest).textContent()) === 'Three native peers.',
    'host fanout',
  );
  await waitFor(
    async () =>
      (await host.getByRole('list', { name: 'Participants' }).getByRole('listitem').count()) === 3,
    'peer presence',
  );
  assert.ok(code.startsWith('veil-p2p:v1:'));
  await third.getByRole('button', { name: 'Leave peer session', exact: true }).click();
  await waitFor(
    async () =>
      (await host.getByRole('list', { name: 'Participants' }).getByRole('listitem').count()) === 2,
    'leave presence',
  );
  const large = 'A'.repeat(70_000);
  await editor(host).fill(large);
  await waitFor(
    async () => (await editor(guest).textContent()) === large,
    'fragmented update beyond a data-channel frame',
  );
  await editor(host).fill('Reconnect baseline.');
  await waitFor(
    async () => (await editor(guest).textContent()) === 'Reconnect baseline.',
    'baseline before pause',
  );
  await guest.getByRole('button', { name: 'Pause connection', exact: true }).click();
  await waitFor(
    async () =>
      (await host.getByRole('list', { name: 'Participants' }).getByRole('listitem').count()) === 1,
    'paused guest removed',
  );
  async function append(page, value) {
    await editor(page).evaluate((element, text) => {
      element.focus();
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('insertText', false, text);
    }, value);
  }
  await append(host, ' Host offline edit.');
  await append(guest, ' Guest offline edit.');
  await connect(host, guest);
  await waitFor(async () => {
    const content = await editor(host).textContent();
    return (
      content.includes('Host offline edit.') &&
      content.includes('Guest offline edit.') &&
      content === (await editor(guest).textContent())
    );
  }, 'state-vector merge after fresh signaling');
  await waitFor(
    async () =>
      (await host.getByRole('list', { name: 'Participants' }).getByRole('listitem').count()) === 2,
    'rejoined awareness clock',
  );
  await host.getByRole('button', { name: 'Show overlay', exact: true }).click();
  const overlay = instances[0].browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((page) => page.url().includes('?overlay'));
  assert.ok(overlay);
  overlay.on('pageerror', (error) => errors.push(error.message));
  await waitFor(
    async () => (await editor(overlay).textContent()) === (await editor(host).textContent()),
    'P2P overlay binding',
  );
  await editor(overlay).fill('Peer overlay edit.');
  await waitFor(
    async () => (await editor(guest).textContent()) === 'Peer overlay edit.',
    'overlay to remote peer',
  );
  await editor(guest).fill('Remote edit in overlay.');
  await waitFor(
    async () => (await editor(overlay).textContent()) === 'Remote edit in overlay.',
    'remote peer to overlay',
  );
  await host.getByRole('button', { name: 'Hide overlay', exact: true }).click();
  for (const page of [host, guest]) {
    await page.locator('textarea').evaluateAll((inputs) =>
      inputs.forEach((input) => {
        input.style.visibility = 'hidden';
      }),
    );
  }
  await host.screenshot({ path: resolve(directory, 'host.png'), fullPage: true });
  await guest.screenshot({ path: resolve(directory, 'guest.png'), fullPage: true });
  await host.getByRole('button', { name: 'End peer session', exact: true }).click();
  await waitFor(
    async () =>
      (await guest.locator('.app-header [role="status"]').textContent()) === 'Disconnected',
    'host shutdown',
  );
  assert.deepEqual(errors, []);
  console.log(
    `Native P2P acceptance passed: three peers, credential rejection, direct path, fragmented updates, offline merge, presence, overlay, shutdown. Screenshots: ${directory}`,
  );
} finally {
  for (const instance of instances) {
    if (instance.browser) await instance.browser.close();
    if (instance.app.exitCode === null) instance.app.kill();
  }
}
