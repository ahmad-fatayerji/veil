// Windows acceptance of native HTTP/WSS, Credential Manager, editor and overlay.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
assert.equal(process.platform, 'win32');
const root = resolve(import.meta.dirname, '..');
await mkdir(resolve(root, 'target/network-native'), { recursive: true });
const directory = await mkdtemp(resolve(root, 'target/network-native/run-'));
const binary = resolve(
  process.env.VEIL_SERVER_SOURCE || resolve(root, '../Veil-server'),
  'target/debug/veil-server.exe',
);
const server = 'http://127.0.0.1:18089';
await writeFile(resolve(directory, 'turn-secret'), randomBytes(32).toString('hex'));
await writeFile(resolve(directory, 'metrics-secret'), randomBytes(32).toString('hex'));
const env = {
  ...process.env,
  HOST_DB: resolve(directory, 'hosts.sqlite'),
  TURN_SECRET_FILE: resolve(directory, 'turn-secret'),
  METRICS_SECRET_FILE: resolve(directory, 'metrics-secret'),
  LISTEN: '127.0.0.1:18089',
  STUN_URLS: 'stun:127.0.0.1:3479',
  TURN_URLS: 'turn:127.0.0.1:3479',
};
const credential = execFileSync(binary, ['issue', 'native-test'], { env, encoding: 'utf8' }).trim();
const instances = [];
const errors = [];
const service = spawn(binary, [], { env, windowsHide: true, stdio: 'ignore' });
async function waitFor(check, label) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error(`Timed out: ${label}`);
}
async function launch(index) {
  const port = 9241 + index;
  const app = spawn(resolve(root, 'target/debug/veil-desktop.exe'), [], {
    cwd: root,
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      VEIL_TEST_LEGACY: '0',
      VEIL_TEST_SETTINGS_DIR: resolve(directory, String(index)),
      WEBVIEW2_USER_DATA_FOLDER: resolve(directory, String(index), 'webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
    },
  });
  const instance = { app, browser: null };
  instances.push(instance);
  await waitFor(
    async () => (await fetch(`http://127.0.0.1:${port}/json/version`).catch(() => null))?.ok,
    'native startup',
  );
  instance.browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = instance.browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((page) => !page.url().includes('?overlay'));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByLabel('Your name', { exact: true }).fill(index ? 'Friend' : 'Host');
  return page;
}
const editor = (page) => page.getByRole('textbox', { name: 'Shared document' });
let host;
try {
  await waitFor(
    async () => (await fetch(`${server}/health`).catch(() => null))?.ok,
    'signaling startup',
  );
  host = await launch(0);
  await host.getByLabel('Server address', { exact: true }).fill(server);
  await host.getByLabel('Host access credential', { exact: true }).fill(credential);
  await host.getByRole('button', { name: 'Create session', exact: true }).click();
  await editor(host).waitFor();
  assert.equal(
    await host.getByLabel('Host access credential', { exact: true }).count(),
    0,
    'credential removed from UI after saving',
  );
  await host.getByRole('button', { name: 'End session', exact: true }).click();
  await host.getByRole('button', { name: 'Create session', exact: true }).click();
  await editor(host).waitFor(); // Blank credential successfully reads Credential Manager.
  const guest = await launch(1);
  await host.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const invitation = await host.getByLabel('Invitation to share').inputValue();
  assert.ok(invitation.startsWith('veil-invite:v2:'));
  await guest.getByLabel('Invitation', { exact: true }).fill(invitation);
  await guest.getByRole('button', { name: 'Join', exact: true }).click();
  await editor(guest).waitFor();
  await editor(host).fill('Native signaling and saved credential.');
  await waitFor(
    async () => (await editor(guest).textContent()) === 'Native signaling and saved credential.',
    'native direct sync',
  );
  await guest.getByRole('button', { name: 'Show overlay', exact: true }).click();
  const overlay = instances[1].browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((page) => page.url().includes('?overlay'));
  assert.ok(overlay);
  await editor(overlay).fill('Overlay through automatic P2P.');
  await waitFor(
    async () => (await editor(host).textContent()) === 'Overlay through automatic P2P.',
    'overlay forwards editing',
  );
  // Actual scoped command verifies updater's native session guard.
  const active = await host.evaluate(() => window.__TAURI_INTERNALS__.invoke('update_status'));
  assert.equal(active.sessionActive, true);
  await guest.getByRole('button', { name: /^Document menu/ }).click();
  await guest.getByRole('menuitem', { name: 'Leave session', exact: true }).click();
  await waitFor(
    async () =>
      (await host.getByRole('list', { name: 'Participants' }).getByRole('listitem').count()) === 1,
    'leave removes presence',
  );
  await host.getByRole('button', { name: 'End session', exact: true }).click();
  await host
    .getByRole('button', { name: 'Forget saved host credential' })
    .waitFor({ state: 'attached' });
  if (!(await host.getByRole('button', { name: 'Forget saved host credential' }).isVisible()))
    await host.getByText('Hosting server', { exact: true }).click();
  await host.getByRole('button', { name: 'Forget saved host credential' }).click();
  assert.deepEqual(errors, []);
  console.log(
    'PASS: Windows native signaling, saved server credential reuse, direct editing, overlay and active-session updater guard.',
  );
} finally {
  if (host)
    await host
      .evaluate((server) => window.__TAURI_INTERNALS__.invoke('network_forget', { server }), server)
      .catch(() => {});
  for (const instance of instances) {
    await instance.browser?.close().catch(() => {});
    instance.app.kill();
  }
  service.kill();
}
