import { test, expect, type Page, type Locator } from '@playwright/test';

async function deleteCharacter(page: Page, editor: Locator, offset: number) {
  await page.bringToFront();
  await editor.evaluate((element, offset) => {
    (element as HTMLElement).focus();
    const text = element.querySelector('p')?.firstChild;
    if (!text || text.nodeType !== Node.TEXT_NODE) throw new Error('Expected a text paragraph');
    const range = document.createRange();
    range.setStart(text, offset + 1);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  }, offset);
  await page.keyboard.press('Backspace');
}

async function join(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Join local session' }).click();
  await expect(page.getByRole('status')).toHaveText('Connected');
}

test('two independent browser clients converge after simultaneous edits, deletes, and reconnect', async ({
  browser,
}) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  const firstErrors: string[] = [];
  first.on('pageerror', (error) => firstErrors.push(error.message));
  second.on('pageerror', (error) => firstErrors.push(error.message));
  try {
    await join(first, 'Alex');
    await join(second, 'Sam');
    await expect(
      first.getByRole('list', { name: 'Participants' }).getByRole('listitem'),
    ).toHaveCount(2);
    const a = first.getByRole('textbox', { name: 'Shared document' });
    const b = second.getByRole('textbox', { name: 'Shared document' });
    await a.fill('shared seed');
    await expect(b).toHaveText('shared seed');

    // Concurrent online transactions against the same paragraph, through Rust only.
    await Promise.all([a.press('Control+End'), b.press('Control+End')]);
    await Promise.all([first.keyboard.insertText(' ALPHA'), second.keyboard.insertText(' BETA')]);
    await expect.poll(async () => (await a.textContent()) === (await b.textContent())).toBe(true);
    await expect(a).toContainText('ALPHA');
    await expect(a).toContainText('BETA');

    await first.getByRole('button', { name: 'Disconnect' }).click();
    await second.getByRole('button', { name: 'Disconnect' }).click();
    await expect(first.getByRole('status')).toHaveText('Disconnected');
    await expect(second.getByRole('status')).toHaveText('Disconnected');
    // Both replicas now edit the same original text independently.
    await deleteCharacter(first, a, 0);
    await expect(a).toHaveText(/^hared seed/);
    await first.keyboard.press('Control+End');
    await first.keyboard.insertText(' offline-A');
    await deleteCharacter(second, b, 1);
    await expect(b).toHaveText(/^sared seed/);
    await second.keyboard.press('Control+End');
    await second.keyboard.insertText(' offline-B');
    await Promise.all([
      first.getByRole('button', { name: 'Reconnect' }).click(),
      second.getByRole('button', { name: 'Reconnect' }).click(),
    ]);
    await expect(first.getByRole('status')).toHaveText('Connected');
    await expect(second.getByRole('status')).toHaveText('Connected');
    await expect.poll(async () => (await a.textContent()) === (await b.textContent())).toBe(true);
    await expect.poll(async () => (await a.textContent())?.startsWith('ared seed')).toBe(true);
    await expect(a).toContainText('offline-A');
    await expect(a).toContainText('offline-B');
    await first.screenshot({ path: test.info().outputPath('collaboration.png'), fullPage: true });

    // A third, fresh context must receive the complete server-held state.
    const lateContext = await browser.newContext();
    try {
      const late = await lateContext.newPage();
      await join(late, 'Late arrival');
      await expect(late.getByRole('textbox', { name: 'Shared document' })).toHaveText(
        (await a.textContent())!,
      );
      await expect(
        first.getByRole('list', { name: 'Participants' }).getByRole('listitem'),
      ).toHaveCount(3);
    } finally {
      await lateContext.close();
    }
    await expect(
      first.getByRole('list', { name: 'Participants' }).getByRole('listitem'),
    ).toHaveCount(2);
    await secondContext.close();
    await expect(
      first.getByRole('list', { name: 'Participants' }).getByRole('listitem'),
    ).toHaveCount(1);
    expect(firstErrors).toEqual([]);
  } finally {
    await firstContext.close();
    await secondContext.close();
  }
});

test('authentication and origin checks reject unauthorized sockets', async ({ page, browser }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const bootstrap = await fetch('http://127.0.0.1:4444/bootstrap');
    const data = await bootstrap.json();
    const rejected = await new Promise<boolean>((resolve) => {
      const socket = new WebSocket('ws://127.0.0.1:4444/ws/m0-demo', ['veil.v1']);
      socket.onopen = () => {
        socket.close();
        resolve(false);
      };
      socket.onerror = () => resolve(true);
    });
    return { rejected, participantLimit: data.participantLimit, token: data.token as string };
  });
  expect(result.rejected).toBe(true);
  expect(result.participantLimit).toBeNull();
  const untrusted = await browser.newContext();
  try {
    const other = await untrusted.newPage();
    // about:blank has an opaque, untrusted origin. A valid token cannot bypass the origin check.
    const rejected = await other.evaluate(
      (token) =>
        new Promise<boolean>((resolve) => {
          const socket = new WebSocket('ws://127.0.0.1:4444/ws/m0-demo', [
            'veil.v1',
            `veil.auth.${token}`,
          ]);
          socket.onopen = () => {
            socket.close();
            resolve(false);
          };
          socket.onerror = () => resolve(true);
        }),
      result.token,
    );
    expect(rejected).toBe(true);
  } finally {
    await untrusted.close();
  }
});
