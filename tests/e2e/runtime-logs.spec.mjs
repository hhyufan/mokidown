import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('runtime errors use the notification and task list, with filtered JSON export', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  await page.evaluate(async () => {
    await (await import('/src/i18n/index.js')).default.changeLanguage('en');
    console.warn('Warning: runtime log fixture warning');
    const error = new Error('runtime log fixture error');
    window.dispatchEvent(new ErrorEvent('error', { error, message: error.message }));
    window.dispatchEvent(new ErrorEvent('error', { error, message: error.message }));
  });
  const toast = page.locator('.notif--error');
  await expect(toast).toHaveCount(1);
  await expect(page.locator('#moki-startup-recovery')).toHaveCount(0);
  await toast.getByRole('button', { name: 'View error log' }).click();
  const dialog = page.getByRole('dialog', { name: 'Error log' });
  await expect(dialog.locator('summary').filter({ hasText: 'runtime log fixture error' })).toContainText('×2');
  await expect(dialog.locator('summary')).toContainText(['runtime log fixture error', 'runtime log fixture warning']);
  await dialog.locator('.ant-select').click();
  await page.getByRole('option', { name: 'Warning', exact: true }).click();
  await expect(dialog.locator('summary')).toHaveCount(1);
  const file = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export shown entries' }).click();
  const exported = JSON.parse(await readFile(await (await file).path(), 'utf8'));
  expect(exported.entries).toEqual([expect.objectContaining({
    level: 'warning', source: 'React', message: 'Warning: runtime log fixture warning',
  })]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.locator('.footer__right .task-status-indicator').click();
  await page.locator('.task-panel').getByRole('button', { name: /Error log/ }).click();
  await expect(dialog).toBeVisible();
});

test('a failed startup script leaves an exportable recovery card', async ({ page }) => {
  await page.route('**/src/main.jsx*', (route) => route.abort());
  await page.goto('/');
  const card = page.locator('#moki-startup-recovery');
  await expect(card).toBeVisible();
  const download = page.waitForEvent('download');
  await card.getByRole('button', { name: /Export error log|导出错误日志/ }).click();
  const exported = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(exported.entries).toContainEqual(expect.objectContaining({
    level: 'error', source: 'Startup', message: 'Could not load application script.',
  }));
});
