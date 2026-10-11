import { expect, test, type Page } from '@playwright/test';
import { version as appVersion } from '../../package.json';

async function join(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Join local session' }).click();
  await expect(page.getByRole('status')).toHaveText('Connected');
}

test('remote cursors, selections, and activity follow their author and clear on leave', async ({
  browser,
}) => {
  const aContext = await browser.newContext();
  const bContext = await browser.newContext();
  const a = await aContext.newPage();
  const b = await bContext.newPage();
  const errors: string[] = [];
  a.on('pageerror', (error) => errors.push(error.message));
  b.on('pageerror', (error) => errors.push(error.message));
  try {
    await join(a, 'Alex');
    const firstEditor = a.getByRole('textbox', { name: 'Shared document' });
    await firstEditor.fill('A shared sentence.');
    await join(b, 'Sam');
    const secondEditor = b.getByRole('textbox', { name: 'Shared document' });
    await expect(secondEditor).toHaveText('A shared sentence.');
    await b.bringToFront();
    await secondEditor.click();
    await expect
      .poll(async () => {
        await secondEditor.press('Control+End');
        return secondEditor.evaluate((editor) => {
          const selection = window.getSelection();
          if (!selection?.isCollapsed || !editor.contains(selection.anchorNode)) return false;
          const beforeCaret = document.createRange();
          beforeCaret.selectNodeContents(editor);
          beforeCaret.setEnd(selection.anchorNode!, selection.anchorOffset);
          return beforeCaret.toString() === editor.textContent;
        });
      })
      .toBe(true);
    await b.keyboard.insertText(' Together.');
    await expect(firstEditor).toHaveText('A shared sentence. Together.');
    const sam = a.locator('[data-participant-name="Sam"]');
    const alex = a.locator('[data-participant-name="Alex"]');
    await expect(sam.locator('.participant-activity')).toHaveText('Typing…');
    await expect(alex.locator('.participant-activity')).not.toHaveText('Typing…');
    const caret = a.locator('.collaboration-carets__label[data-name="Sam"]');
    await expect(caret).toBeVisible();
    await expect(a.locator('.collaboration-carets__label[data-name="Alex"]')).toHaveCount(0);
    await expect(sam.locator('.participant-activity')).toHaveText('In document');
    await secondEditor.press('Control+a');
    await expect(sam.locator('.participant-activity')).toHaveText('Selecting text');
    await expect(a.locator('.collaboration-selection[data-selection-user="Sam"]')).toBeVisible();
    await a.screenshot({
      path: test.info().outputPath('minimal-editor-presence.png'),
      fullPage: true,
    });
    await secondEditor.press('ArrowRight');
    await expect(a.locator('.collaboration-selection[data-selection-user="Sam"]')).toHaveCount(0);
    await b.getByRole('button', { name: 'Leave session' }).click();
    await b
      .getByRole('dialog', { name: 'Leave session?' })
      .getByRole('button', { name: 'Leave session', exact: true })
      .click();
    await expect(sam).toHaveCount(0);
    await expect(caret).toHaveCount(0);
    await expect(b.getByRole('status')).toHaveText('Not connected');
    expect(errors).toEqual([]);
  } finally {
    await aContext.close();
    await bContext.close();
  }
});

test('About credits the developer and Settings closes with Escape', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Version ' + appVersion);
  await expect(dialog).toContainText('Developed by Ahmad Fatayerji.');
  await expect(dialog.getByRole('heading', { name: 'Developer', exact: true })).toHaveCount(0);
  await expect(dialog).not.toContainText('Documents are temporary.');
  await expect(dialog).not.toContainText('Documents live in memory.');
  const website = dialog.getByRole('link', { name: 'ahmadfatayerji.com' });
  await expect(website).toHaveAttribute('href', 'https://ahmadfatayerji.com');
  await expect(website).toHaveAttribute('target', '_blank');
  await expect(website).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(dialog.getByText('Roadmap', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('about.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: test.info().outputPath('mobile-join.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
