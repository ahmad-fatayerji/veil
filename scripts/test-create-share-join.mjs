// Real Windows/WebView2 document lifecycle and reusable sharing acceptance.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

assert.equal(process.platform, 'win32');
const root = resolve(import.meta.dirname, '..');
const serverRoot = resolve(process.env.VEIL_SERVER_SOURCE || resolve(root, '../Veil-server'));
await mkdir(resolve(root, 'target/create-share-join'), { recursive: true });
const directory = await mkdtemp(resolve(root, 'target/create-share-join/run-'));
const binary = resolve(serverRoot, 'target/debug/veil-server.exe');
const server = 'http://127.0.0.1:18089';
await writeFile(resolve(directory, 'turn-secret'), randomBytes(32).toString('hex'));
await writeFile(resolve(directory, 'metrics-secret'), randomBytes(32).toString('hex'));
const serverEnv = {
  ...process.env,
  HOST_DB: resolve(directory, 'hosts.sqlite'),
  TURN_SECRET_FILE: resolve(directory, 'turn-secret'),
  METRICS_SECRET_FILE: resolve(directory, 'metrics-secret'),
  STUN_URLS: 'stun:127.0.0.1:3479',
  TURN_URLS: 'turn:127.0.0.1:3479',
  LISTEN: '127.0.0.1:18089',
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
  const endpoint = `http://127.0.0.1:${9240 + index}`;
  launch(resolve(root, 'target/debug/veil-desktop.exe'), [], {
    ...process.env,
    VEIL_TEST_SETTINGS_DIR: profile,
    WEBVIEW2_USER_DATA_FOLDER: resolve(profile, 'webview'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${9240 + index}`,
  });
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
  const createTab = host.getByRole('tab', { name: 'Create document' });
  await createTab.focus();
  await host.keyboard.press('ArrowRight');
  await expect(host.getByRole('tab', { name: 'Join session' })).toBeFocused();
  await expect(host.getByLabel('Session link')).toBeVisible();
  await host.keyboard.press('Home');
  await expect(createTab).toBeFocused();
  await screenshot(host, 'welcome-light');
  await host.getByRole('textbox', { name: /Your name/ }).fill('Alex');
  assert.equal(await host.getByLabel('Server address').isVisible(), false);
  await host.getByRole('button', { name: 'Create document', exact: true }).click();
  const editor = host.getByRole('textbox', { name: 'Shared document' });
  await editor.fill('Written before sharing.');
  assert.equal(
    (await invoke(host, 'update_status')).sessionActive,
    true,
    'local document blocks updates',
  );
  await host.getByRole('button', { name: 'Share', exact: true }).click();
  let dialog = host.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(dialog.getByRole('heading', { name: 'Hosting server' })).toBeVisible();
  await dialog.getByLabel('Server address').fill(server);
  await dialog.getByLabel('Host access credential').fill(credential);
  await dialog.getByRole('button', { name: 'Save and share' }).click();
  const share = host.getByRole('dialog', { name: 'Share document', exact: true });
  await expect(share).toBeVisible();
  const link = await share.getByLabel('Session link').inputValue();
  assert.ok(link.startsWith('veil://join/'));
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
    await page.getByRole('tab', { name: 'Join session', exact: true }).click();
    await page.getByRole('textbox', { name: /Your name/ }).fill(name);
    await page.getByLabel('Session link').fill(link);
    await page.getByRole('button', { name: 'Join session', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Shared document' })).toHaveText(
      'Written before sharing.',
    );
  }
  await guest.getByRole('textbox', { name: 'Shared document' }).press('Control+End');
  await guest.keyboard.insertText(' From Sam.');
  await expect(editor).toContainText('From Sam.');
  await expect(other.getByRole('textbox', { name: 'Shared document' })).toContainText('From Sam.');
  await host.getByRole('button', { name: 'Share', exact: true }).click();
  assert.equal(await share.getByLabel('Session link').inputValue(), link, 'Share reuses link');
  await share.getByRole('button', { name: 'Reset link', exact: true }).click();
  await expect(share.getByLabel('Session link')).not.toHaveValue(link);
  await share.getByRole('button', { name: 'Stop sharing', exact: true }).click();
  await expect(
    share.getByText('New people cannot join. Existing collaborators stay connected.'),
  ).toBeVisible();
  await share.getByRole('button', { name: 'Close Share document' }).click();
  await other.getByRole('textbox', { name: 'Shared document' }).press('Control+End');
  await other.keyboard.insertText(' After sharing stopped.');
  await expect(editor).toContainText('After sharing stopped.');
  dialog = await settings(host, 'Appearance');
  await dialog.getByLabel('Theme').selectOption('dark');
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
  await waitFor(
    () => overlay.evaluate(() => document.documentElement.dataset.theme === 'dark'),
    'overlay theme synchronization',
  );
  await screenshot(overlay, 'overlay-dark');
  dialog = await settings(host, 'Overlay');
  await screenshot(host, 'settings-dark');
  await dialog.getByRole('button', { name: 'Close Settings' }).click();
  await host.setViewportSize({ width: 480, height: 720 });
  await host.getByRole('button', { name: 'Hide people' }).click();
  await screenshot(host, 'workspace-narrow');
  assert.equal(
    await host.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  await host.getByRole('button', { name: 'Close document', exact: true }).click();
  const confirmation = host.getByRole('dialog', { name: 'Close document?', exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Cancel' }).click();
  await expect(editor).toContainText('After sharing stopped.');
  await host.getByRole('button', { name: 'Close document', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Close document', exact: true }).click();
  await expect(host.getByRole('tab', { name: 'Create document' })).toBeVisible();
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
