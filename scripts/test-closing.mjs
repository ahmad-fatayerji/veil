// Real Windows/WebView2 acceptance for every way of closing Veil: tray and window
// quit, chained save prompts, cancellation, saved files, overlay, sharing and restore.
// usage: node scripts/test-closing.mjs [case name filter]
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

assert.equal(process.platform, 'win32');
const root = resolve(import.meta.dirname, '..');
const filter = process.argv[2];
const desktopExe = resolve(
  process.env.VEIL_CLOSING_DESKTOP_BINARY || resolve(root, 'target/debug/veil-desktop.exe'),
);
const serverExe = resolve(
  process.env.VEIL_SERVER_SOURCE || resolve(root, '../Veil-server'),
  'target/debug/veil-server.exe',
);
await mkdir(resolve(root, 'target/closing-acceptance'), { recursive: true });
const base = await mkdtemp(resolve(root, 'target/closing-acceptance/run-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const children = [];
async function port() {
  const l = createServer();
  await new Promise((d) => l.listen(0, '127.0.0.1', d));
  const p = l.address().port;
  await new Promise((d) => l.close(d));
  return p;
}
async function waitFor(check, label, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check().catch(() => false)) return;
    await sleep(150);
  }
  throw new Error(`Timed out: ${label}`);
}

// Local sharing server, so no test touches public infrastructure.
const serverPort = await port();
const server = `http://127.0.0.1:${serverPort}`;
await writeFile(join(base, 'turn'), randomBytes(32).toString('hex'));
await writeFile(join(base, 'metrics'), randomBytes(32).toString('hex'));
const serverEnv = {
  ...process.env,
  HOST_DB: join(base, 'hosts.sqlite'),
  TURN_SECRET_FILE: join(base, 'turn'),
  METRICS_SECRET_FILE: join(base, 'metrics'),
  STUN_URLS: 'stun:127.0.0.1:3479',
  TURN_URLS: 'turn:127.0.0.1:3479',
  LISTEN: `127.0.0.1:${serverPort}`,
};
// The server limits each host to 10 new sessions a minute, so every share gets its own host.
let hosts = 0;
const credential = () =>
  execFileSync(serverExe, ['issue', `close-test-${hosts++}`], {
    env: serverEnv,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
const serverProcess = spawn(serverExe, [], { env: serverEnv, windowsHide: true, stdio: 'ignore' });
children.push(serverProcess);
await waitFor(async () => (await fetch(`${server}/health`)).ok, 'server');

let counter = 0;
async function launch({ args = [], keepProfile } = {}) {
  const profile = keepProfile ?? join(base, `app-${counter++}`);
  await mkdir(profile, { recursive: true });
  const debug = await port();
  const proc = spawn(desktopExe, args, {
    cwd: root,
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      VEIL_TEST_SETTINGS_DIR: profile,
      WEBVIEW2_USER_DATA_FOLDER: join(profile, 'webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debug}`,
    },
  });
  children.push(proc);
  const exited = new Promise((d) => proc.once('exit', (code) => d(code)));
  await waitFor(async () => (await fetch(`http://127.0.0.1:${debug}/json/version`)).ok, 'cdp');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debug}`);
  const pages = () => browser.contexts().flatMap((c) => c.pages());
  await waitFor(async () => pages().some((p) => p.url().includes('?overlay')), 'overlay page');
  const main = pages().find((p) => !p.url().includes('?overlay'));
  const overlay = pages().find((p) => p.url().includes('?overlay'));
  const errors = [];
  for (const page of [main, overlay]) page.on('pageerror', (e) => errors.push(e.message));
  await main.getByRole('button', { name: 'Settings', exact: true }).first().waitFor();
  const invoke = (command, args, page = main) =>
    page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
      command,
      args,
    });
  const native = (action, window = 'main') =>
    execFileSync(
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
        String(proc.pid),
        '-Window',
        window,
      ],
      { windowsHide: true, encoding: 'utf8' },
    ).trim();
  const app = {
    proc,
    main,
    overlay,
    browser,
    errors,
    profile,
    invoke,
    native,
    alive: () => proc.exitCode === null,
    async exits(label = 'app exits', ms = 15000) {
      const code = await Promise.race([exited, sleep(ms).then(() => 'timeout')]);
      if (code === 'timeout') {
        const state = await main
          .evaluate(() => ({
            busy: document.querySelector('.document-workspace')?.getAttribute('aria-busy'),
            dialogs: [...document.querySelectorAll('dialog[open]')].map((d) =>
              d.innerText.slice(0, 120),
            ),
            alerts: [...document.querySelectorAll('[role=alert]')].map((d) =>
              d.innerText.slice(0, 160),
            ),
          }))
          .catch((e) => String(e));
        throw new Error(`${label}: still running after ${ms}ms ${JSON.stringify(state)}`);
      }
      if (code !== 0) throw new Error(`${label}: exit code ${code}`);
    },
    async staysOpen(ms = 2500) {
      await sleep(ms);
      if (!app.alive()) throw new Error('app exited but should have stayed open');
    },
    async newDoc(text) {
      await main.getByRole('button', { name: 'New document', exact: true }).click();
      const editor = main.locator('[role=tabpanel]:not([hidden]) .tiptap');
      await editor.waitFor();
      await editor.fill(text);
    },
    prompt: () => main.locator('dialog[open]'),
    async answer(title, button) {
      const dialog = main.getByRole('dialog', { name: title });
      await expect(dialog).toBeVisible({ timeout: 8000 });
      await dialog.getByRole('button', { name: button, exact: true }).click();
    },
    async noPrompt() {
      await sleep(800);
      const open = await main.locator('dialog[open]').allInnerTexts();
      if (open.length) throw new Error(`unexpected dialog: ${open[0].slice(0, 80)}`);
    },
    async errorBanner() {
      return (await main.locator('.toast[role=alert]').allInnerTexts()).filter(
        (t) => !t.startsWith('Global shortcut unavailable'),
      );
    },
    async closeBehavior(value) {
      await main.getByRole('button', { name: 'Settings', exact: true }).first().click();
      const settings = main.getByRole('dialog', { name: 'Settings', exact: true });
      await settings.getByLabel('When closing the main window').selectOption(value);
      await waitFor(
        async () => (await invoke('overlay_snapshot')).settings.closeBehavior === value,
        'close behavior',
      );
      await settings.getByRole('button', { name: 'Close Settings' }).click();
    },
    async share(name = 'Host') {
      await invoke('network_configure', { server, credential: credential() });
      await main.getByRole('button', { name: 'Share', exact: true }).click();
      const dialog = main.getByRole('dialog', { name: 'Share document', exact: true });
      const nameBox = dialog.getByRole('textbox', { name: /Your name/ });
      if (await nameBox.count()) await nameBox.fill(name);
      const own = dialog.getByRole('radio', { name: 'My own server', exact: true });
      if (await own.count()) await own.click();
      const address = dialog.getByLabel('Server address');
      if (await address.count()) await address.fill(server);
      const create = dialog.getByRole('button', { name: 'Create invite link', exact: true });
      if (await create.count()) await create.click();
      const link = dialog.getByLabel('Invite link');
      await expect(link).toHaveValue(/^veil:\/\//, { timeout: 20000 });
      const value = await link.inputValue();
      await dialog.getByRole('button', { name: 'Close Share document' }).click();
      return value;
    },
    async kill() {
      await browser.close().catch(() => {});
      if (proc.exitCode === null) proc.kill();
    },
  };
  apps.push(app);
  return app;
}
const apps = [];
// Records what was on screen when a case failed: open dialogs, banners and a screenshot.
async function evidence(name) {
  for (const [index, app] of apps.entries()) {
    if (!app.alive()) continue;
    const path = join(base, `${name.replace(/\W+/g, '-')}-${index}.png`);
    const state = await app.main
      .evaluate(() => ({
        dialogs: [...document.querySelectorAll('dialog[open]')].map((d) =>
          d.innerText.slice(0, 160),
        ),
        alerts: [...document.querySelectorAll('[role=alert]')].map((d) =>
          d.innerText.slice(0, 160),
        ),
        tabs: [...document.querySelectorAll('[role=tab]')].map((t) => t.innerText),
      }))
      .catch((cause) => String(cause));
    await app.main.screenshot({ path }).catch(() => {});
    console.log(`      app ${index}: ${JSON.stringify(state)}\n      screenshot: ${path}`);
  }
}

const cases = [];
const test = (name, run) => cases.push({ name, run });

test('tray quit with only Home exits immediately', async () => {
  const a = await launch();
  await a.invoke('app_quit');
  await a.exits();
});
test('window X in default tray mode hides, then tray quit exits', async () => {
  const a = await launch();
  await a.newDoc('kept while hidden');
  a.native('Close');
  await waitFor(async () => !JSON.parse(a.native('Probe')).visible, 'main hidden');
  await a.staysOpen();
  await a.invoke('app_quit');
  await a.answer(/^Save changes to/, 'Discard');
  await a.exits();
});
test('window X in Quit mode with no changes exits', async () => {
  const a = await launch();
  await a.closeBehavior('quit');
  a.native('Close');
  await a.exits();
});
test('one unsaved tab: Discard exits', async () => {
  const a = await launch();
  await a.newDoc('one');
  await a.invoke('app_quit');
  await a.answer(/^Save changes to/, 'Discard');
  await a.exits();
});
test('two unsaved tabs: Discard, Discard exits', async () => {
  const a = await launch();
  await a.newDoc('one');
  await a.newDoc('two');
  await a.invoke('app_quit');
  await a.answer(/^Save changes to/, 'Discard');
  await a.answer(/^Save changes to/, 'Discard');
  await a.exits();
});
test('three unsaved tabs via window X in Quit mode: Discard x3 exits', async () => {
  const a = await launch();
  await a.closeBehavior('quit');
  await a.newDoc('one');
  await a.newDoc('two');
  await a.newDoc('three');
  a.native('Close');
  for (let i = 0; i < 3; i++) await a.answer(/^Save changes to/, 'Discard');
  await a.exits();
});
test('Cancel on second prompt keeps every tab, quitting again still works', async () => {
  const a = await launch();
  await a.newDoc('one');
  await a.newDoc('two');
  await a.invoke('app_quit');
  await a.answer(/^Save changes to/, 'Discard');
  await a.answer(/^Save changes to/, 'Cancel');
  await a.staysOpen();
  await a.noPrompt();
  const tabs = await a.main.getByRole('tab').count();
  if (tabs !== 2) throw new Error(`expected 2 tabs after cancel, got ${tabs}`);
  await a.invoke('app_quit');
  await a.answer(/^Save changes to/, 'Discard');
  await a.answer(/^Save changes to/, 'Discard');
  await a.exits();
});
test('Escape on the prompt cancels, quitting again still works', async () => {
  const a = await launch();
  await a.newDoc('one');
  await a.newDoc('two');
  await a.invoke('app_quit');
  await expect(a.main.getByRole('dialog', { name: /^Save changes to/ })).toBeVisible();
  await a.main.keyboard.press('Escape');
  await a.staysOpen();
  await a.noPrompt();
  await a.invoke('app_quit');
  await a.answer(/^Save changes to/, 'Discard');
  await a.answer(/^Save changes to/, 'Discard');
  await a.exits();
});
test('dialog X button cancels, quitting again still works', async () => {
  const a = await launch();
  await a.newDoc('one');
  await a.invoke('app_quit');
  const dialog = a.main.getByRole('dialog', { name: /^Save changes to/ });
  await dialog.getByRole('button', { name: /^Close Save changes/ }).click();
  await a.staysOpen();
  await a.noPrompt();
  await a.invoke('app_quit');
  await a.answer(/^Save changes to/, 'Discard');
  await a.exits();
});
test('saved file: Save writes to disk then exits; second untitled tab Discard', async () => {
  const file = join(base, `notes-${counter}.md`);
  await writeFile(file, '# Notes\n\nOriginal\n');
  const a = await launch({ args: [file] });
  const editor = a.main.locator('[role=tabpanel]:not([hidden]) .tiptap');
  await expect(editor).toContainText('Original', { timeout: 10000 });
  await editor.press('Control+End');
  await a.main.keyboard.insertText(' Edited');
  await a.newDoc('scratch');
  await a.invoke('app_quit');
  // Tabs are resolved in order: the file first, then the scratch tab.
  await a.answer(/^Save changes to/, 'Save');
  await a.answer(/^Save changes to/, 'Discard');
  await a.exits();
  const saved = await readFile(file, 'utf8');
  if (!saved.includes('Edited')) throw new Error(`file not saved: ${saved}`);
});
test('two quit requests at once show one prompt per tab', async () => {
  const a = await launch();
  await a.newDoc('one');
  await Promise.all([a.invoke('app_quit'), a.invoke('app_quit')]);
  await a.answer(/^Save changes to/, 'Cancel');
  await a.staysOpen();
  await a.noPrompt();
  await a.invoke('app_quit');
  await a.answer(/^Save changes to/, 'Discard');
  await a.exits();
});
test('quit requested while a tab-close prompt is open runs after it', async () => {
  const a = await launch();
  await a.newDoc('one');
  await a.main
    .getByRole('button', { name: /^Close / })
    .first()
    .click();
  await expect(a.main.getByRole('dialog', { name: /^Save changes to/ })).toBeVisible();
  await a.invoke('app_quit');
  await a.answer(/^Save changes to/, 'Discard');
  await a.exits();
});
test('quit requested during startup is honoured', async () => {
  const a = await launch();
  // Fresh profile: fire immediately after the control panel mounts.
  await a.invoke('app_quit');
  await a.exits();
});
test('visible overlay with unsaved document: Discard exits', async () => {
  const a = await launch();
  await a.newDoc('overlay text');
  await a.invoke('overlay_visibility', { visible: true });
  await expect(a.overlay.locator('.tiptap')).toContainText('overlay text');
  await a.overlay.locator('.tiptap').press('End');
  await a.overlay.keyboard.insertText(' typed in overlay');
  await a.invoke('app_quit');
  await a.answer(/^Save changes to/, 'Discard');
  await a.exits();
});
test('overlay hidden for 20s: quit still flushes and exits', async () => {
  const a = await launch();
  await a.newDoc('idle');
  await a.invoke('overlay_visibility', { visible: false });
  a.native('Close');
  await sleep(20000);
  await a.invoke('app_quit');
  await a.answer(/^Save changes to/, 'Discard');
  await a.exits();
});
test('shared tab: Discard then End session exits', async () => {
  const a = await launch();
  await a.newDoc('shared');
  await a.share();
  await a.invoke('app_quit');
  await a.answer(/^Save changes to/, 'Discard');
  await a.answer('End this shared session?', 'End session');
  await a.exits();
});
test('shared tab + unsaved tab: Discard, End session, Discard exits', async () => {
  const a = await launch();
  await a.newDoc('shared');
  await a.share();
  await a.newDoc('local');
  await a.invoke('app_quit');
  await a.answer(/^Save changes to/, 'Discard');
  await a.answer('End this shared session?', 'End session');
  await a.answer(/^Save changes to/, 'Discard');
  await a.exits();
});
test('shared tab: Cancel at End session keeps sharing', async () => {
  const a = await launch();
  await a.newDoc('shared');
  await a.share();
  await a.invoke('app_quit');
  await a.answer(/^Save changes to/, 'Discard');
  await a.answer('End this shared session?', 'Cancel');
  await a.staysOpen();
  await a.noPrompt();
  if (!(await a.main.locator('.share-button[data-sharing]').count()))
    throw new Error('sharing stopped after cancel');
  await a.invoke('app_quit');
  await a.answer(/^Save changes to/, 'Discard');
  await a.answer('End this shared session?', 'End session');
  await a.exits();
});
test('closing a shared unsaved tab chains Discard then End session', async () => {
  const a = await launch();
  await a.newDoc('shared');
  await a.share();
  await a.main
    .getByRole('button', { name: /^Close / })
    .first()
    .click();
  await a.answer(/^Save changes to/, 'Discard');
  await a.answer('End this shared session?', 'End session');
  await waitFor(async () => (await a.main.getByRole('tab').count()) === 1, 'tab closed');
  await a.invoke('app_quit');
  await a.exits();
});
test('guest quits while connected; host can still quit afterwards', async () => {
  const host = await launch();
  await host.newDoc('host doc');
  const link = await host.share();
  const guest = await launch();
  await guest.main.getByRole('button', { name: /^Join with a link/ }).click();
  await guest.main.getByLabel('Invite link').fill(link);
  await guest.main.getByRole('textbox', { name: /Your name/ }).fill('Guest');
  await guest.main.getByRole('button', { name: 'Join session', exact: true }).click();
  await expect(guest.main.locator('[role=tabpanel]:not([hidden]) .tiptap')).toContainText(
    'host doc',
    { timeout: 30000 },
  );
  await guest.invoke('app_quit');
  await guest.answer(/^Save changes to/, 'Discard');
  await guest.exits('guest');
  await host.invoke('app_quit');
  await host.answer(/^Save changes to/, 'Discard');
  await host.answer('End this shared session?', 'End session');
  await host.exits('host');
});
test('quit while a guest is still joining', async () => {
  const host = await launch();
  await host.newDoc('host doc');
  const link = await host.share();
  // Only approved guests: the guest waits, so the join stays in progress.
  await host.main.getByRole('button', { name: 'Share', exact: true }).click();
  const share = host.main.getByRole('dialog', { name: 'Share document', exact: true });
  await share.getByRole('radio', { name: 'Only people I approve' }).click();
  await share.getByRole('button', { name: 'Close Share document' }).click();
  const guest = await launch();
  await guest.main.getByRole('button', { name: /^Join with a link/ }).click();
  await guest.main.getByLabel('Invite link').fill(link);
  await guest.main.getByRole('textbox', { name: /Your name/ }).fill('Waiting');
  await guest.main.getByRole('button', { name: 'Join session', exact: true }).click();
  await expect(guest.main.getByRole('dialog', { name: 'Joining session' })).toBeVisible({
    timeout: 20000,
  });
  await guest.invoke('app_quit');
  await guest.exits('waiting guest');
  await host.kill();
});
test('restart after quitting restores saved file tab, not discarded drafts', async () => {
  const file = join(base, `restore-${counter}.md`);
  await writeFile(file, '# Restore\n\nOn disk\n');
  const profile = join(base, `restore-profile-${counter}`);
  let a = await launch({ args: [file], keepProfile: profile });
  await a.main.getByRole('button', { name: 'Settings', exact: true }).first().click();
  const settings = a.main.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.locator('#restore-tabs').click({ force: true });
  await waitFor(async () => settings.locator('#restore-tabs').isChecked(), 'restore enabled');
  await settings.getByRole('button', { name: 'Close Settings' }).click();
  await a.newDoc('throwaway draft');
  await a.invoke('app_quit');
  await a.answer(/^Save changes to/, 'Discard');
  await a.exits();
  await a.browser.close().catch(() => {});
  a = await launch({ keepProfile: profile });
  await expect(a.main.locator('[role=tabpanel]:not([hidden]) .tiptap')).toContainText('On disk', {
    timeout: 10000,
  });
  const titles = await a.main.getByRole('tab').allInnerTexts();
  if (titles.some((t) => /throwaway/.test(t))) throw new Error(`draft returned: ${titles}`);
  await a.invoke('app_quit');
  await a.exits();
});

const results = [];
for (const { name, run } of cases.filter((c) => !filter || c.name.includes(filter))) {
  const started = Date.now();
  const before = children.length;
  try {
    await run();
    results.push(['PASS', name]);
    console.log(`PASS  ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (error) {
    results.push(['FAIL', name, error.message.split('\n')[0]]);
    // eslint-disable-next-line no-control-regex
    const message = error.message.replace(/\x1b\[[0-9;]*m/g, '').split('\n');
    console.log(`FAIL  ${name}\n      ${message.slice(0, 12).join('\n      ')}`);
    await evidence(name);
  } finally {
    apps.length = 0;
    for (const child of children.slice(before)) if (child.exitCode === null) child.kill();
  }
}
for (const child of children) if (child.exitCode === null) child.kill();
const failed = results.filter(([s]) => s === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
