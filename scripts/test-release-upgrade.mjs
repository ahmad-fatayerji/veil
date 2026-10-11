// Real HTTPS upgrade of an existing installation. Never start over an active Veil process.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, copyFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

assert.equal(process.platform, 'win32');
const [channel, expectedVersion] = process.argv.slice(2);
assert.ok(['stable', 'beta'].includes(channel));
assert.match(expectedVersion ?? '', /^\d+\.\d+\.\d+(?:-beta\.\d+)?$/);
const powershell = (command) =>
  execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
assert.equal(
  powershell('@(Get-Process veil-desktop -ErrorAction SilentlyContinue).Count'),
  '0',
  'Close Veil before real upgrade acceptance; never interrupt an active document.',
);
const registrations = JSON.parse(
  powershell(
    "ConvertTo-Json -Compress -InputObject @(Get-ItemProperty 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/*' -ErrorAction SilentlyContinue | Where-Object DisplayName -EQ 'Veil' | Select-Object InstallLocation,DisplayVersion)",
  ),
);
assert.equal(registrations.length, 1, 'Requires exactly one existing per-user Veil installation.');
const installed = resolve(
  registrations[0].InstallLocation.replace(/^"|"$/g, ''),
  'veil-desktop.exe',
);
const privateRoot = resolve(
  process.env.LOCALAPPDATA,
  'Veil-consolidation-private',
  'installed-upgrades',
);
await mkdir(privateRoot, { recursive: true });
const evidence = await mkdtemp(resolve(privateRoot, 'run-'));
const preferences = resolve(process.env.APPDATA, 'dev.veil.desktop');
await mkdir(resolve(evidence, 'preferences-before'), { recursive: true });
for (const item of await readdir(preferences, { withFileTypes: true }).catch(() => []))
  if (item.isFile())
    await copyFile(
      resolve(preferences, item.name),
      resolve(evidence, 'preferences-before', item.name),
    );
const endpoint = 'http://127.0.0.1:9246';
assert.equal(
  await fetch(`${endpoint}/json/version`).catch(() => null),
  null,
  'Acceptance port must be unused.',
);
const app = spawn(installed, [], {
  windowsHide: true,
  stdio: 'ignore',
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
      '--remote-debugging-port=9246 --remote-debugging-address=127.0.0.1',
  },
});
let browser, page, originalChannel;
const invoke = (command, args) =>
  page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
    command,
    args,
  });
async function waitFor(check, label, milliseconds = 120_000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`Timed out: ${label}`);
}
async function connect() {
  await waitFor(
    async () => (await fetch(`${endpoint}/json/version`).catch(() => null))?.ok,
    'installed WebView2',
  );
  browser = await chromium.connectOverCDP(endpoint);
  await waitFor(
    () =>
      browser
        .contexts()
        .flatMap((context) => context.pages())
        .some((item) => item.url().includes('tauri') && !item.url().includes('?overlay')),
    'main window',
  );
  page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((item) => item.url().includes('tauri') && !item.url().includes('?overlay'));
  await page.waitForLoadState('domcontentloaded');
  await waitFor(
    async () =>
      await invoke('update_status').then(
        () => true,
        () => false,
      ),
    'native updater ready',
  );
}
try {
  await connect();
  const before = await invoke('update_status');
  assert.equal(before.currentVersion, registrations[0].DisplayVersion);
  assert.equal(before.sessionActive, false, 'Never upgrade an active document.');
  originalChannel = before.channel;
  const settings = (await invoke('overlay_snapshot')).settings;
  await invoke('document_open');
  assert.equal((await invoke('update_status')).sessionActive, true);
  await assert.rejects(invoke('update_install'), /End|leave|document|session/i);
  await invoke('document_closed');
  await invoke('update_set_channel', { channel });
  await invoke('update_check');
  await waitFor(
    async () => (await invoke('update_status')).availableVersion === expectedVersion,
    'real public update manifest',
  );
  const install = invoke('update_install').catch(() => {}); // The old WebView closes during installer handoff.
  await waitFor(() => app.exitCode !== null, 'old application exit', 300_000);
  await install;
  await browser.close().catch(() => {});
  browser = null;
  // Wait for the old debugging endpoint to disappear before accepting the new process.
  await waitFor(
    async () => !(await fetch(`${endpoint}/json/version`).catch(() => null))?.ok,
    'old WebView shutdown',
  );
  await connect();
  const after = await invoke('update_status');
  assert.equal(after.currentVersion, expectedVersion);
  const retained = (await invoke('overlay_snapshot')).settings;
  for (const key of ['opacity', 'fontSize', 'alwaysOnTop', 'clickThrough', 'captureExclusion']) {
    assert.ok(Object.hasOwn(settings, key), `Missing preference: ${key}`);
    assert.deepEqual(retained[key], settings[key], `Upgrade must preserve ${key}`);
  }
  assert.equal(after.completion?.success, true, 'Relaunch must confirm the installed version.');
  await page.screenshot({ path: resolve(evidence, 'updated.png'), fullPage: true });
  console.log(
    `Real signed HTTPS ${channel} upgrade ${before.currentVersion} -> ${expectedVersion} passed; existing preferences retained. Private evidence: ${evidence}`,
  );
} finally {
  if (page && browser) {
    if (originalChannel)
      await invoke('update_set_channel', { channel: originalChannel }).catch(() => {});
    await invoke('document_closed').catch(() => {});
    await invoke('app_quit').catch(() => {});
    await browser.close().catch(() => {});
  }
  if (app.exitCode === null) app.kill();
}
