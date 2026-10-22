// Real Windows/WebView2 document lifecycle and reusable sharing acceptance.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { chromium, expect } from '@playwright/test';

assert.equal(process.platform, 'win32');
const root = resolve(import.meta.dirname, '..');
const serverRoot = resolve(process.env.VEIL_SERVER_SOURCE || resolve(root, '../Veil-server'));
await mkdir(resolve(root, 'target/create-share-join'), { recursive: true });
const directory = await mkdtemp(resolve(root, 'target/create-share-join/run-'));
const binary = resolve(serverRoot, 'target/debug/veil-server.exe');
async function unusedPort() {
  const listener = createServer();
  await new Promise((done, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', done);
  });
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  return port;
}
const serverPort = await unusedPort();
const server = `http://127.0.0.1:${serverPort}`;
await writeFile(resolve(directory, 'turn-secret'), randomBytes(32).toString('hex'));
await writeFile(resolve(directory, 'metrics-secret'), randomBytes(32).toString('hex'));
const serverEnv = {
  ...process.env,
  HOST_DB: resolve(directory, 'hosts.sqlite'),
  TURN_SECRET_FILE: resolve(directory, 'turn-secret'),
  METRICS_SECRET_FILE: resolve(directory, 'metrics-secret'),
  STUN_URLS: 'stun:127.0.0.1:3479',
  TURN_URLS: 'turn:127.0.0.1:3479',
  LISTEN: `127.0.0.1:${serverPort}`,
};
const credential = execFileSync(binary, ['issue', 'ux-test'], {
  env: serverEnv,
  encoding: 'utf8',
  windowsHide: true,
}).trim();
const children = [],
  browsers = [],
  errors = [];
const launch = (file, args, env) => {
  const child = spawn(file, args, { env, windowsHide: true, stdio: 'ignore' });
  children.push(child);
  return child;
};
const invoke = (page, command, args) =>
  page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
    command,
    args,
  });
async function waitFor(check, label, timeout = 30_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error(`Timed out: ${label}`);
}
async function app(index) {
  const profile = resolve(directory, `app-${index}`);
  await mkdir(profile);
  const debugPort = await unusedPort();
  const endpoint = `http://127.0.0.1:${debugPort}`;
  launch(
    resolve(
      process.env.VEIL_SHARING_DESKTOP_BINARY || resolve(root, 'target/debug/veil-desktop.exe'),
    ),
    [],
    {
      ...process.env,
      VEIL_TEST_SETTINGS_DIR: profile,
      WEBVIEW2_USER_DATA_FOLDER: resolve(profile, 'webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
    },
  );
  await waitFor(
    async () => (await fetch(`${endpoint}/json/version`).catch(() => null))?.ok,
    'WebView2',
  );
  const browser = await chromium.connectOverCDP(endpoint);
  browsers.push(browser);
  await waitFor(
    () =>
      browser
        .contexts()
        .flatMap((context) => context.pages())
        .some((page) => !page.url().includes('?overlay')),
    'main window',
  );
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((page) => !page.url().includes('?overlay'));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: 'Settings', exact: true }).waitFor();
  return { page, browser };
}
async function settings(page, section) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Settings sections' })
    .getByRole('button', { name: section, exact: true })
    .click();
  return page.getByRole('dialog', { name: 'Settings', exact: true });
}
async function closeDocument(page) {
  await page.getByRole('button', { name: /^Document menu/ }).click();
  await page.getByRole('menuitem', { name: 'Close document', exact: true }).click();
}
async function screenshot(page, name) {
  await page.screenshot({
    path: resolve(directory, `${name}.png`),
    mask: [
      page.locator('#share-link'),
      page.locator('#automatic-credential'),
      page.locator('#automatic-invitation'),
    ],
  });
}
let host;
try {
  launch(binary, [], serverEnv);
  await waitFor(async () => (await fetch(`${server}/health`).catch(() => null))?.ok, 'server');
  host = (await app(0)).page;
  await host.keyboard.press('Control+j');
  await expect(host.getByLabel('Invite link')).toBeFocused();
  await host.keyboard.press('Escape');
  await expect(host.getByRole('button', { name: /^Join with a link/ })).toBeFocused();
  await expect(host.getByLabel('Invite link')).toHaveCount(0);
  await screenshot(host, 'welcome-light');
  assert.equal(await host.getByLabel('Server address').isVisible(), false);
  await host.getByRole('button', { name: /^New document/ }).click();
  const editor = host.getByRole('textbox', { name: 'Shared document' });
  await editor.fill('Written before sharing.');
  assert.equal(
    (await invoke(host, 'update_status')).sessionActive,
    true,
    'local document blocks updates',
  );
  await host.getByRole('button', { name: 'Share', exact: true }).click();
  // The first invitation asks who is hosting before any server setup.
  const shareSetup = host.getByRole('dialog', { name: 'Share document', exact: true });
  await shareSetup.getByRole('textbox', { name: /Your name/ }).fill('Alex');
  await shareSetup.getByRole('button', { name: 'Create invite link', exact: true }).click();
  let dialog = host.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(dialog.getByRole('heading', { name: 'Hosting server' })).toBeVisible();
  await dialog.getByLabel('Server address').fill(server);
  const testConnection = dialog.getByRole('button', { name: 'Test connection', exact: true });
  const testResult = dialog.locator('form').getByRole('status');
  const saveAndShare = dialog.getByRole('button', { name: 'Save and share', exact: true });
  async function assertUnsaved() {
    assert.equal(
      (await invoke(host, 'network_preferences')).server,
      '',
      'failed save preserves preferences',
    );
    await assert.rejects(
      invoke(host, 'network_test', { server, credential: null }),
      /Enter an operator-issued host credential/,
      'failed save stores no credential',
    );
    await expect(dialog).toBeVisible();
  }
  await saveAndShare.click();
  await expect(testResult).toContainText('Enter an operator-issued host credential');
  await assertUnsaved();
  await dialog.getByLabel('Host access credential').fill('a'.repeat(64));
  await saveAndShare.click();
  await expect(testResult).toContainText('Host credential rejected');
  await assertUnsaved();
  await dialog.getByLabel('Host access credential').fill(credential);
  await dialog.getByLabel('Server address').fill('http://127.0.0.1:1');
  await saveAndShare.click();
  await expect(testResult).toHaveText('Server unavailable or HTTPS certificate invalid.');
  await assertUnsaved();
  await dialog.getByLabel('Server address').fill(server);
  await dialog.getByLabel('Host access credential').fill('');

  await testConnection.click();
  await expect(testResult).toContainText('Enter an operator-issued host credential');
  await dialog.getByLabel('Host access credential').fill('a'.repeat(64));
  await expect(testResult).toBeEmpty();
  await testConnection.click();
  await expect(testResult).toContainText('Host credential rejected');
  await dialog.getByLabel('Host access credential').fill('bad-format');
  await testConnection.click();
  await expect(testResult).toHaveText('Invalid operator-issued host credential.');
  await dialog.getByLabel('Host access credential').fill(credential);
  await dialog.getByLabel('Server address').fill('http://127.0.0.1:1');
  await testConnection.click();
  await expect(testResult).toHaveText('Server unavailable or HTTPS certificate invalid.');
  await dialog.getByLabel('Server address').fill(server);
  await dialog.getByLabel('Host access credential').fill(credential);
  await testConnection.click();
  await expect(testResult).toHaveText('Connection successful. Host credential accepted.');
  assert.equal(
    (await invoke(host, 'network_preferences')).server,
    '',
    'test does not save settings',
  );
  assert.equal(
    (await dialog.getByLabel('Host access credential').inputValue()) === credential,
    true,
    'test preserves entered credential',
  );
  const metrics = await fetch(`${server}/v2/metrics`, {
    headers: {
      Authorization: `Bearer ${await readFile(resolve(directory, 'metrics-secret'), 'utf8')}`,
    },
  }).then((response) => response.json());
  assert.equal(metrics.sessions, 0, 'temporary test registration is removed');
  assert.equal(metrics.relayGrants, 0, 'credential testing allocates no relay');
  await screenshot(host, 'server-test-success');
  await dialog.getByLabel('Host access credential').fill('a'.repeat(64));
  await saveAndShare.click();
  await expect(testResult).toContainText('Host credential rejected');
  await assertUnsaved();
  await dialog.getByLabel('Host access credential').fill(credential);
  await saveAndShare.click();
  const share = host.getByRole('dialog', { name: 'Share document', exact: true });
  await expect(share).toBeVisible();
  const link = await share.getByLabel('Invite link').inputValue();
  assert.match(link, /^veil:\/\/join\/[^/]+\/[A-Za-z0-9_-]{22}$/);
  await share.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(share.getByRole('status')).toHaveText('Link copied.');
  await share.getByRole('button', { name: 'Close Share document' }).click();
  await expect(editor).toHaveText('Written before sharing.');
  await screenshot(host, 'workspace-light');
  const guest = (await app(1)).page,
    other = (await app(2)).page;
  for (const [page, name] of [
    [guest, 'Sam'],
    [other, 'Jo'],
  ]) {
    if (name === 'Jo') {
      await host.getByRole('button', { name: 'Share', exact: true }).click();
      await share.getByRole('radio', { name: 'Only people I approve' }).click();
      assert.equal(await share.getByLabel('Invite link').inputValue(), link);
      await share.getByRole('button', { name: 'Close Share document' }).click();
    }
    await page.getByRole('button', { name: /^Join with a link/ }).click();
    await page.getByLabel('Invite link').fill(link);
    await page.getByRole('textbox', { name: /Your name/ }).fill(name);
    await page.getByRole('button', { name: 'Join session', exact: true }).click();
    if (name === 'Jo') {
      await expect(
        page.getByRole('dialog', { name: 'Joining session', exact: true }),
      ).toContainText('Waiting for the host');
      await expect(page.getByRole('textbox', { name: 'Shared document' })).toHaveCount(0);
      const requests = host.getByRole('region', { name: 'Join requests' });
      await expect(requests).toContainText('Jo');
      await host.getByRole('button', { name: 'Share', exact: true }).click();
      await share.getByRole('radio', { name: 'Anyone with the link' }).click();
      assert.equal(await share.getByLabel('Invite link').inputValue(), link);
      await share.getByRole('button', { name: 'Close Share document' }).click();
      await expect(page.getByRole('textbox', { name: 'Shared document' })).toHaveCount(0);
      await requests.getByRole('button', { name: 'Approve', exact: true }).click();
      await expect(requests).toHaveCount(0);
    }
    await expect(page.getByRole('textbox', { name: 'Shared document' })).toHaveText(
      'Written before sharing.',
    );
  }
  await guest.getByRole('textbox', { name: 'Shared document' }).press('Control+End');
  await guest.keyboard.insertText(' From Sam.');
  await expect(editor).toContainText('From Sam.');
  await expect(other.getByRole('textbox', { name: 'Shared document' })).toContainText('From Sam.');
  await host.getByRole('button', { name: 'Share', exact: true }).click();
  assert.equal(await share.getByLabel('Invite link').inputValue(), link, 'Share reuses link');
  await share.getByRole('button', { name: 'Reset link', exact: true }).click();
  await expect(share.getByLabel('Invite link')).not.toHaveValue(link);
  await share.getByRole('button', { name: 'Stop sharing', exact: true }).click();
  await expect(
    share.getByText('Sharing is off. New people can’t join; current collaborators stay connected.'),
  ).toBeVisible();
  await share.getByRole('button', { name: 'Close Share document' }).click();
  await other.getByRole('textbox', { name: 'Shared document' }).press('Control+End');
  await other.keyboard.insertText(' After sharing stopped.');
  await expect(editor).toContainText('After sharing stopped.');
  dialog = await settings(host, 'Hosting server');
  await dialog.getByLabel('Host access credential').fill('a'.repeat(64));
  await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(dialog.locator('form').getByRole('status')).toContainText(
    'Host credential rejected',
  );
  assert.equal(
    (await invoke(host, 'network_preferences')).server,
    server,
    'failed replacement preserves origin',
  );
  await dialog.getByLabel('Host access credential').fill('');
  await assert.rejects(
    invoke(host, 'network_configure', {
      server: 'http://127.0.0.1:1',
      credential: null,
    }),
    /Enter an operator-issued host credential/,
    'a new origin cannot reuse another origin credential',
  );

  await dialog.getByRole('button', { name: 'Test connection', exact: true }).click();
  await expect(dialog.locator('form').getByRole('status')).toHaveText(
    'Connection successful. Host credential accepted.',
  );
  await dialog.getByRole('button', { name: 'Close Settings' }).click();
  await expect(editor).toContainText('After sharing stopped.');
  dialog = await settings(host, 'Appearance');
  await dialog.getByRole('radio', { name: 'Dark', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close Settings' }).click();
  await screenshot(host, 'workspace-dark');
  await host.getByRole('button', { name: 'Show overlay' }).click();
  const overlay = browsers[0]
    .contexts()
    .flatMap((context) => context.pages())
    .find((page) => page.url().includes('?overlay'));
  await expect(overlay.getByRole('textbox', { name: 'Shared document' })).toContainText(
    'After sharing stopped.',
  );
  await assert.rejects(
    invoke(overlay, 'network_test', { server, credential: null }),
    /Only the control panel can manage networking/,
  );
  await waitFor(
    () => overlay.evaluate(() => document.documentElement.dataset.theme === 'dark'),
    'overlay theme synchronization',
  );
  await screenshot(overlay, 'overlay-dark');
  dialog = await settings(host, 'Overlay');
  await screenshot(host, 'settings-dark');
  await dialog.getByRole('button', { name: 'Close Settings' }).click();
  await host.setViewportSize({ width: 480, height: 720 });
  await host.getByRole('button', { name: /^People/ }).click();
  await host.getByRole('button', { name: 'Hide people' }).click();
  await expect(host.getByRole('button', { name: /^People/ })).toBeFocused();
  await screenshot(host, 'workspace-narrow');
  assert.equal(
    await host.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  await closeDocument(host);
  const confirmation = host.getByRole('dialog', { name: 'Close document?', exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Cancel' }).click();
  await expect(editor).toContainText('After sharing stopped.');
  await closeDocument(host);
  await confirmation.getByRole('button', { name: 'Close document', exact: true }).click();
  await expect(host.getByRole('button', { name: /^New document/ })).toBeVisible();
  assert.equal((await invoke(host, 'update_status')).sessionActive, false);
  await expect(guest.getByRole('status').first()).toHaveText('Disconnected');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: native offline document, settings-only setup, reusable sharing, multi-guest edits, reset/stop, theme and overlay synchronization, exit confirmation, and local-document updater guard.',
  );
  console.log(`Redacted screenshots: ${directory}`);
} finally {
  if (host) await invoke(host, 'network_forget', { server }).catch(() => {});
  for (const browser of browsers) await browser.close().catch(() => {});
  for (const child of children) child.kill();
}
