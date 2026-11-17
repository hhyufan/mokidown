import { expect, test } from '@playwright/test';

test('plugin development docs open as an interactive HTML editor tab', async ({ page }) => {
  await page.goto('/tests/settings-harness.html?plugin-docs');
  const openDocs = async () => {
    await expect(page.locator('.settings-modal')).toBeVisible();
    await page.locator('.settings-modal__nav li', { hasText: /^插件$/ }).click();
    await page.getByRole('button', { name: /^(Plugin development|插件开发)$/ }).click();
    await page.getByRole('button', { name: /^(Plugin development docs|插件开发文档)$/ }).click();
  };
  await openDocs();
  await expect(page.locator('.settings-modal')).toBeHidden();
  const docs = page.frameLocator('iframe.editor-content__builtin-html');
  await expect(docs.locator('main h1')).toBeVisible();
  await docs.locator('#api-filter').fill('editor.getActiveDocument');
  await expect(docs.locator('.api-card:visible')).toHaveCount(1);
  await page.getByRole('button', { name: 'Open settings' }).click();
  await openDocs();
  expect(await page.evaluate(() => window.trial.docsTabs())).toHaveLength(1);
});
