// Captures real Veil UI for the promo: three isolated instances (Alex hosts in dark,
// Sam joins in light, Priya joins in light) on a loopback-only server.
// Output: public/capture/*.png stills and *.mp4 clips with *.json click logs.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  encode,
  frame,
  invoke,
  record,
  runDirectory,
  shutdown,
  sleep,
  startApp,
  startServer,
  waitFor,
} from './lib.mjs';

const W = 1280;
const H = 800;
const output = resolve(import.meta.dirname, '../public/capture');
await mkdir(output, { recursive: true });
const directory = await runDirectory();
console.log(`Run: ${directory}`);

// Blurs any invitation text (fields and plain text) so no usable link appears in media.
async function maskInvites(page) {
  await page.evaluate(() => {
    const mask = () => {
      for (const input of document.querySelectorAll('input, textarea')) {
        if (input.value?.includes('veil://')) input.style.filter = 'blur(6px)';
      }
      for (const element of document.querySelectorAll('body *')) {
        if (
          element.childElementCount === 0 &&
          element.textContent?.includes('veil://') &&
          !element.closest('[contenteditable="true"]')
        ) {
          element.style.filter = 'blur(6px)';
        }
      }
    };
    mask();
    new MutationObserver(mask).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    setInterval(mask, 50);
  });
}

async function profile(page, name, theme) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await dialog.getByRole('textbox', { name: 'Your name' }).fill(name);
  await dialog.getByRole('radio', { name: theme, exact: true }).click();
  await sleep(300);
  await dialog.getByRole('button', { name: 'Close Settings' }).click();
  await sleep(300);
}

async function setTheme(page, theme) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await dialog.getByRole('button', { name: 'General', exact: true }).click();
  await dialog.getByRole('radio', { name: theme, exact: true }).click();
  await sleep(300);
  await dialog.getByRole('button', { name: 'Close Settings' }).click();
  await sleep(400);
}

// A recording plus a log of pointer and key events in viewport CSS pixels.
async function clip(page, name, size = { width: W, height: H }) {
  const recorder = await record(page, directory, name);
  const started = Date.now() / 1000;
  const events = [];
  const at = () => +(Date.now() / 1000 - started).toFixed(3);
  return {
    page,
    async click(locator, { steps = 18, pause = 220 } = {}) {
      const box = await locator.boundingBox();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      events.push({ t: at(), type: 'move', x, y });
      await page.mouse.move(x, y, { steps });
      await sleep(pause);
      events.push({ t: at(), type: 'click', x, y });
      await page.mouse.click(x, y);
    },
    async drag(locator, toX, { steps = 30 } = {}) {
      const box = await locator.boundingBox();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      events.push({ t: at(), type: 'move', x, y });
      await page.mouse.move(x, y, { steps: 12 });
      events.push({ t: at(), type: 'down', x, y });
      await page.mouse.down();
      await page.mouse.move(toX, y, { steps });
      events.push({ t: at(), type: 'up', x: toX, y });
      await page.mouse.up();
    },
    async type(text, delay = 32) {
      events.push({ t: at(), type: 'type-start', text });
      await page.keyboard.type(text, { delay });
      events.push({ t: at(), type: 'type-end' });
    },
    async key(key) {
      events.push({ t: at(), type: 'key', key });
      await page.keyboard.press(key);
    },
    mark(label) {
      events.push({ t: at(), type: 'mark', label });
    },
    async stop() {
      const result = await recorder.stop();
      await encode(result, resolve(output, `${name}.mp4`));
      await writeFile(
        resolve(output, `${name}.json`),
        JSON.stringify(
          { ...size, scale: 2, duration: result.ended - result.started, events },
          null,
          2,
        ),
      );
      console.log(
        `clip ${name}: ${(result.ended - result.started).toFixed(1)}s, ${result.frames.length} frames`,
      );
    },
  };
}

const still = (page, name) => page.screenshot({ path: resolve(output, `${name}.png`) });

const OW = 600;
const OH = 660;

try {
  const server = await startServer(directory);
  const alex = await startApp(directory, 'alex');
  await frame(alex.page, W, H);
  await maskInvites(alex.page);
  await profile(alex.page, 'Alex', 'Light');
  await alex.page.mouse.move(W - 4, H / 2);
  await still(alex.page, 'home-light');
  await setTheme(alex.page, 'Dark');
  await alex.page.mouse.move(W - 4, H / 2);
  await still(alex.page, 'home-dark');
  await invoke(alex.page, 'network_configure', {
    server: server.url,
    credential: server.credential,
  });

  // 1. Alex starts a document from the home screen and writes it.
  let c = await clip(alex.page, 'write');
  await sleep(700);
  await c.click(alex.page.getByRole('button', { name: /^New document Start writing/ }));
  await sleep(600);
  await c.click(alex.page.getByRole('textbox', { name: 'Document title' }), { steps: 10 });
  await c.type('Launch day', 55);
  await c.key('Enter');
  await c.type('## Before we go live\n', 28);
  await c.type('A calm place for the notes that keep the conversation moving.\n', 18);
  await c.type(
    '[ ] Check the demo and audio\nOpen the release notes\nLeave time for questions\n\n',
    24,
  );
  await c.type('## Talking points\n', 28);
  await c.type(
    '- Keep it close: a floating, editable overlay.\nBring people in: one link, shared notes.\n\n',
    18,
  );
  await sleep(900);
  await c.stop();
  await still(alex.page, 'workspace-dark');

  // 2. Alex shares it. Hosting is pointed at the loopback server off camera, never the
  //    public servers, and the run aborts if the link points anywhere else.
  const share = alex.page.getByRole('dialog', { name: 'Share document', exact: true });
  await alex.page.getByRole('button', { name: 'Share', exact: true }).click();
  await share.waitFor();
  await share.getByRole('radio', { name: 'My own server', exact: true }).click();
  await share.getByLabel('Server address').fill(server.url);
  await share.getByLabel('Host access credential').fill(server.credential);
  await share.getByRole('button', { name: 'Create invite link', exact: true }).click();
  const linkField = share.getByLabel('Invite link');
  await waitFor(async () => (await linkField.inputValue()).startsWith('veil://'), 'invite link');
  const link = await linkField.inputValue();
  if (!link.includes('127.0.0.1')) throw new Error('Invite link is not on the loopback server');
  await share.getByRole('button', { name: 'Close Share document' }).click();
  await sleep(500);

  c = await clip(alex.page, 'share');
  await sleep(500);
  await c.click(alex.page.getByRole('button', { name: 'Share', exact: true }));
  await share.waitFor();
  await sleep(900);
  await c.click(share.getByRole('button', { name: 'Copy link', exact: true }));
  await sleep(1300);
  await c.click(share.getByRole('button', { name: 'Close Share document' }));
  await sleep(600);
  await c.stop();
  await still(alex.page, 'share-done');

  // 3. Sam (light) and Priya join; record Sam's join and Alex's view together.
  const sam = await startApp(directory, 'sam');
  await frame(sam.page, W, H);
  await maskInvites(sam.page);
  await profile(sam.page, 'Sam', 'Light');
  const priya = await startApp(directory, 'priya');
  await frame(priya.page, W, H);
  await maskInvites(priya.page);
  await profile(priya.page, 'Priya', 'Light');

  const host = await clip(alex.page, 'join-host');
  c = await clip(sam.page, 'join-guest');
  await sleep(600);
  await c.click(sam.page.getByRole('button', { name: /^Join with a link/ }));
  await sleep(400);
  await sam.page.getByLabel('Invite link').fill(link);
  c.mark('pasted');
  await sleep(500);
  const samName = sam.page.getByRole('textbox', { name: /Your name/ });
  if ((await samName.count()) && !(await samName.inputValue())) await samName.fill('Sam');
  await c.click(sam.page.getByRole('button', { name: 'Join session', exact: true }));
  await sam.page.getByRole('textbox', { name: 'Shared document' }).waitFor({ timeout: 30_000 });
  await sleep(1200);
  host.mark('priya-joins');
  await priya.page.getByRole('button', { name: /^Join with a link/ }).click();
  await priya.page.getByLabel('Invite link').fill(link);
  const priyaName = priya.page.getByRole('textbox', { name: /Your name/ });
  if ((await priyaName.count()) && !(await priyaName.inputValue())) await priyaName.fill('Priya');
  await priya.page.getByRole('button', { name: 'Join session', exact: true }).click();
  await priya.page.getByRole('textbox', { name: 'Shared document' }).waitFor({ timeout: 30_000 });
  await sleep(1200);
  await host.click(alex.page.getByRole('button', { name: /^People/ }));
  await sleep(1500);
  await c.stop();
  await host.stop();

  // 4. Live co-editing, recorded from Alex (dark) and Sam (light) at once.
  const collabHost = await clip(alex.page, 'collab-host');
  const collabGuest = await clip(sam.page, 'collab-guest');
  await sleep(600);
  const samDoc = sam.page.getByRole('textbox', { name: 'Shared document' });
  await samDoc.click();
  await sam.page.keyboard.press('Control+End');
  await collabGuest.type('Sam: I checked the demo. Ready when you are.', 45);
  await sleep(400);
  await priya.page.getByRole('checkbox').first().click();
  collabHost.mark('priya-checks');
  await sleep(700);
  await collabHost.click(alex.page.getByRole('checkbox').nth(1));
  await sleep(500);
  await collabHost.click(
    alex.page.getByRole('textbox', { name: 'Shared document' }).locator('p').last(),
    { steps: 14 },
  );
  await alex.page.keyboard.press('Control+End');
  await alex.page.keyboard.press('Enter');
  await collabHost.type('Alex: Great, starting in five.', 45);
  await sleep(1200);
  await collabGuest.stop();
  await collabHost.stop();
  await still(sam.page, 'workspace-light');
  await still(alex.page, 'workspace-dark-shared');

  // 5. The overlay: Alex shows it, edits flow in, and opacity is tuned.
  c = await clip(alex.page, 'overlay-show');
  await sleep(500);
  await c.click(alex.page.getByRole('button', { name: 'Show overlay' }));
  await waitFor(async () => Boolean(alex.overlay()), 'overlay window', 15_000);
  await sleep(1200);
  await c.stop();
  const overlay = alex.overlay();
  // The native window's position and size, read before emulation changes the viewport.
  const rect = await overlay.evaluate(() => ({
    x: screenX,
    y: screenY,
    width: outerWidth,
    height: outerHeight,
    dpr: devicePixelRatio,
  }));
  await writeFile(resolve(directory, 'overlay-rect.json'), JSON.stringify(rect));
  await frame(overlay, OW, OH);
  await maskInvites(overlay);
  await sleep(600);
  await still(overlay, 'overlay');

  c = await clip(overlay, 'overlay-live', { width: OW, height: OH });
  await sleep(700);
  await samDoc.click();
  await sam.page.keyboard.press('Control+End');
  await sam.page.keyboard.press('Enter');
  await sam.page.keyboard.type('Sam: Slides are up on screen.', { delay: 45 });
  await sleep(500);
  await c.click(overlay.getByRole('checkbox').nth(2));
  await sleep(500);
  await c.click(overlay.getByRole('textbox', { name: 'Shared document' }).locator('p').last(), {
    steps: 12,
  });
  await overlay.keyboard.press('Control+End');
  await overlay.keyboard.press('Enter');
  await c.type('Wrap up by 3:30', 60);
  await sleep(1200);
  await c.stop();
  await still(overlay, 'overlay-after');

  // Capture exclusion is checked separately, against a known background: exclusion.mjs.

  // Overlay settings: drag window opacity while recording the overlay itself.
  await alex.page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = alex.page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('button', { name: 'Overlay', exact: true }).click();
  await sleep(500);
  await still(alex.page, 'overlay-settings');
  const opacity = settings.getByRole('slider').first();
  const box = await opacity.boundingBox();
  const settingsClip = await clip(alex.page, 'overlay-settings');
  const overlayClip = await clip(overlay, 'overlay-opacity', { width: OW, height: OH });
  await sleep(600);
  await settingsClip.drag(opacity, box.x + box.width * 0.25, { steps: 40 });
  await sleep(700);
  const thumb = await opacity.boundingBox();
  await settingsClip.drag(opacity, thumb.x + thumb.width * 0.8, { steps: 30 });
  await sleep(900);
  await overlayClip.stop();
  await settingsClip.stop();
  await settings.getByRole('button', { name: 'Close Settings' }).click();

  await invoke(alex.page, 'network_forget', { server: server.url }).catch(() => {});
  console.log('Capture complete.');
} finally {
  await shutdown();
}
