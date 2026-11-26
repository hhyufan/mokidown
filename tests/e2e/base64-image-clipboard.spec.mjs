import { expect, test } from '@playwright/test';

const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZs0AAAAASUVORK5CYII=';

test('Monaco folds an embedded image on a single line and selects the real closing bracket', async ({ page, context }) => {
  test.setTimeout(60000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  const content = `![embedded](data:image/png;base64,${'ABCD'.repeat(4000)})`;
  await page.evaluate(async (content) => {
    const { default: store } = await import('/src/store/useEditorStore.js');
    store.getState().openFile({ path: '/base64.md', name: 'base64.md', content });
    store.getState().setViewMode('edit');
    window.readSource = async () => {
      const { getBuffer } = await import('/src/utils/editorBuffer.js');
      return getBuffer(store.getState().activeTabId, content);
    };
  }, content);
  const editor = page.locator('.monaco-editor').first();
  const toggle = editor.locator('.moki-base64-toggle').first();
  await expect(toggle).toHaveText('… Base64 …');
  const line = editor.locator('.view-line').first();
  const delimiter = line.locator('span').filter({ hasText: /^\)$/ }).last();
  await expect(delimiter).toHaveText(')');
  const opening = line.locator('span').filter({ hasText: /\($/ }).last();
  await expect(delimiter).toHaveCSS('color', await opening.evaluate((node) => getComputedStyle(node).color));
  await expect(editor.locator('.view-line')).toHaveCount(1);
  await editor.locator('textarea').focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Control+c');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(')');
  await toggle.click();
  await expect(toggle).not.toHaveClass(/moki-base64-collapsed/);
  await expect(editor.locator('.view-line').nth(1)).toBeVisible();
  await editor.locator('textarea').focus();
  await page.keyboard.press('Control+End');
  await editor.locator('.moki-base64-end-toggle').click();
  await expect(editor.locator('.view-line')).toHaveCount(1);
  const toggleBounds = await toggle.boundingBox();
  const lineBounds = await line.boundingBox();
  const closingBounds = await delimiter.boundingBox();
  await page.mouse.move(toggleBounds.x - 3, lineBounds.y + lineBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(closingBounds.x + closingBounds.width + 4, lineBounds.y + lineBounds.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(toggle).toHaveClass(/moki-base64-collapsed/);
  await page.keyboard.press('Control+c');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(`${'ABCD'.repeat(8)})`);
  expect(await page.evaluate(() => window.readSource())).toBe(content);
});

test('copying a selected Milkdown image writes a PNG and Monaco pastes image Markdown', async ({
  page, context,
}) => {
  test.setTimeout(60000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  await page.evaluate(async (pixel) => {
    const { default: store } = await import('/src/store/useEditorStore.js');
    store.getState().openFile({ path: '/clipboard-image.md', name: 'clipboard-image.md',
      content: `![pixel](${pixel})` });
    store.getState().setViewMode('preview');
  }, pixel);
  const image = page.locator('.milkdown-editor').getByRole('img', { name: 'pixel' });
  await image.click();
  await expect(page.locator('.milkdown-media-preview-host .ant-image-preview-img')).toBeVisible();
  await page.keyboard.press('Control+c');
  await expect.poll(() => page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    return items.flatMap((item) => item.types);
  })).toEqual(['image/png']);
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const { default: store } = await import('/src/store/useEditorStore.js');
    store.getState().openFile({ path: '/pasted-image.md', name: 'pasted-image.md', content: '' });
    store.getState().setViewMode('edit');
  });
  const editor = page.locator('.monaco-editor').first();
  await editor.locator('textarea').focus();
  await page.evaluate(() => {
    window.firstImagePaint = null;
    const measure = () => {
      const lines = document.querySelector('.monaco-editor .view-lines');
      if (!lines?.textContent.includes('![')) return requestAnimationFrame(measure);
      window.firstImagePaint = Boolean(lines.querySelector('.moki-base64-collapsed'));
    };
    requestAnimationFrame(measure);
  });
  await page.keyboard.press('Control+v');
  await expect(editor.locator('.moki-base64-toggle').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.firstImagePaint)).toBe(true);
});
