import { test, expect } from '@playwright/test';

test('appearance persists, follows system changes, and does not replace the document', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.getByLabel('Your name').fill('Theme tester');
  await page.getByRole('button', { name: 'Join local session' }).click();
  const editor = page.getByRole('textbox', { name: 'Shared document' });
  await editor.fill('Keep this document.');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await dialog.getByLabel('Theme').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await dialog.getByRole('button', { name: 'Close Settings' }).click();
  await expect(editor).toHaveText('Keep this document.');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
  await page.screenshot({ path: test.info().outputPath('browser-dark.png'), fullPage: true });
  await page.getByRole('button', { name: 'Leave session', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Leave session?' });
  await confirmation.getByRole('button', { name: 'Cancel' }).click();
  await expect(editor).toHaveText('Keep this document.');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await dialog.getByLabel('Theme').selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await dialog.getByRole('button', { name: 'Close Settings' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
