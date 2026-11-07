import { expect, test } from '@playwright/test';

test('recovery uses a full Monaco diff, switches files and restores only checked drafts', async ({ page }) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/tests/fixtures/recovery-diff.html');
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.monaco-diff-editor')).toBeVisible({ timeout: 45000 });
  await expect(dialog.locator('.editor.original')).toBeVisible();
  await expect(dialog.locator('.editor.modified')).toBeVisible();
  await expect.poll(async () => {
    const label = await dialog.locator('.conflict-dialog__pane-label--remote').boundingBox();
    const pane = await dialog.locator('.editor.modified').boundingBox();
    return Math.abs(label.x - pane.x);
  }).toBeLessThan(2);
  await expect(dialog.locator('pre')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.recoveryFixture.monaco.editor.getModels().map((model) => model.getValue()).some((value) => value.includes('complete draft ending')))).toBe(true);
  await expect(dialog.locator('.conflict-dialog__monaco')).toHaveCSS('min-height', '0px');
  await dialog.getByRole('button', { name: /untitled.md/ }).click();
  await expect.poll(() => page.evaluate(() => window.recoveryFixture.monaco.editor.getModels().some((model) => model.getValue() === '# Unsaved new document\n'))).toBe(true);
  expect(await page.evaluate(() => window.recoveryFixture.monaco.editor.getModels().length)).toBe(2);
  await expect(dialog.locator('.conflict-dialog__pane-label--local')).toContainText(/无可用|No disk content/);
  await dialog.getByRole('button', { name: /missing.txt/ }).click();
  await expect.poll(() => page.evaluate(() => window.recoveryFixture.monaco.editor.getModels().some((model) => model.getValue() === 'Recovered missing file\n'))).toBe(true);
  await dialog.locator('.recovery-modal__list').getByRole('checkbox').first().uncheck();
  await dialog.getByRole('button', { name: /恢复所选|Restore selected/ }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => window.recoveryFixture.restored)).toEqual(['new', 'missing']);
  await expect.poll(() => page.evaluate(() => window.recoveryFixture.monaco.editor.getModels().length)).toBe(0);
  expect(errors).toEqual([]);
});

test('recovery comparison and footer use the glass surface in light and dark themes', async ({ page }) => {
  await page.goto('/tests/fixtures/recovery-diff.html?glass');
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.diff-hidden-lines .center').first()).toBeVisible({ timeout: 20000 });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((mode) => { document.documentElement.dataset.theme = mode; }, theme);
    const backgrounds = await dialog.evaluate((element) => {
      const context = document.createElement('canvas').getContext('2d');
      const alpha = (selector) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = getComputedStyle(element.querySelector(selector)).backgroundColor;
        context.fillRect(0, 0, 1, 1);
        return context.getImageData(0, 0, 1, 1).data[3];
      };
      return {
        pane: alpha('.editor.original'),
        editor: alpha('.monaco-editor-background'),
        fold: alpha('.diff-hidden-lines .center'),
        labels: alpha('.conflict-dialog__pane-labels'),
        footer: alpha('.ant-modal-footer'),
      };
    });
    expect(backgrounds).toMatchObject({ pane: 0, editor: 0, footer: 0 });
    expect(backgrounds.fold).toBeGreaterThan(0);
    expect(backgrounds.fold).toBeLessThan(255);
    expect(backgrounds.labels).toBeGreaterThan(0);
    expect(backgrounds.labels).toBeLessThan(255);
  }
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 600 }, { width: 390, height: 780 }]) {
  test(`recovery scrolls only its file list and editor at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    test.setTimeout(60000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto('/tests/fixtures/recovery-diff.html?many=1');
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('.monaco-diff-editor')).toBeVisible({ timeout: 45000 });
    await expect.poll(() => page.evaluate(() => window.recoveryFixture.monaco.editor.getDiffEditors().length)).toBe(1);
    const outer = await dialog.evaluate((element) => {
      const body = element.querySelector('.ant-modal-body'), content = element.querySelector('.ant-modal-content');
      const rect = content.getBoundingClientRect();
      return { bodyOverflow: getComputedStyle(body).overflowY, bodyHeight: body.clientHeight, bodyScroll: body.scrollHeight,
        contentHeight: content.clientHeight, contentScroll: content.scrollHeight, top: rect.top, bottom: rect.bottom };
    });
    expect(outer.bodyOverflow).toBe('hidden');
    expect(outer.bodyScroll).toBeLessThanOrEqual(outer.bodyHeight + 1);
    expect(outer.contentScroll).toBeLessThanOrEqual(outer.contentHeight + 1);
    expect(outer.top).toBeGreaterThanOrEqual(0); expect(outer.bottom).toBeLessThanOrEqual(viewport.height);
    const footerBefore = await dialog.locator('.ant-modal-footer').boundingBox();
    const list = dialog.locator('.recovery-modal__list');
    await list.hover(); await page.mouse.wheel(0, 500);
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const editor = dialog.locator('.editor.modified .monaco-scrollable-element');
    await editor.hover(); await page.mouse.wheel(0, 500);
    await expect.poll(() => page.evaluate(() => window.recoveryFixture.monaco.editor.getDiffEditors()[0].getModifiedEditor().getScrollTop())).toBeGreaterThan(0);
    const footerAfter = await dialog.locator('.ant-modal-footer').boundingBox();
    expect(footerAfter.y).toBe(footerBefore.y);
    expect(await dialog.locator('.ant-modal-body').evaluate((element) => element.scrollTop)).toBe(0);
    expect(errors).toEqual([]);
  });
}
