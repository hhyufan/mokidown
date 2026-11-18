import { expect, test } from '@playwright/test';

const html = `<style>body { color: rgb(20, 70, 130); }</style>
<h1>Live HTML</h1><button id="count" onclick="this.textContent='clicked'">click</button>`;

test('HTML files use edit, split and preview modes and refresh unsaved edits', async ({ page }) => {
  test.setTimeout(90_000);
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 40000 }).catch((error) => {
    throw new Error(`${error.message}\nPage errors: ${failures.join('\n')}`);
  });
  await page.evaluate(async (content) => {
    const { default: config } = await import('/src/store/useConfigStore.js');
    config.getState().setConfig('autoSave', false);
    const { default: store } = await import('/src/store/useEditorStore.js');
    store.getState().openFile({ path: '/site/index.html', name: 'index.html', content });
    store.getState().setViewMode('edit');
  }, html);
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await expect(page.locator('.html-preview__frame')).toHaveCount(0);
  await page.getByRole('button', { name: /^(Split view|分屏)$/ }).click();
  const preview = page.frameLocator('.html-preview__frame');
  await expect(preview.locator('h1')).toHaveText('Live HTML');
  await expect(preview.locator('h1')).toHaveCSS('color', 'rgb(20, 70, 130)');
  const address = page.locator('.html-preview__bar');
  await expect(address.getByRole('textbox')).toHaveValue('about:srcdoc');
  await expect(address.getByRole('button')).toHaveCount(1);
  await preview.locator('body').evaluate((body) => { body.style.margin = '0'; body.style.minWidth = '1600px'; });
  await expect.poll(() => page.locator('.html-preview__frame').evaluate((frame) => ({
    width: parseFloat(frame.style.width),
    fits: Math.abs(frame.getBoundingClientRect().width - frame.parentElement.clientWidth) < 1,
  }))).toEqual({ width: 1600, fits: true });
  await preview.locator('#count').click();
  await expect(preview.locator('#count')).toHaveText('clicked');
  await page.evaluate(async () => {
    const { setBuffer } = await import('/src/utils/editorBuffer.js');
    setBuffer('/site/index.html', '<h1>unsaved update</h1>');
  });
  await expect(preview.locator('h1')).toHaveText('unsaved update');
  await page.evaluate(async () => (await import('/src/store/useEditorStore.js')).default.getState().setViewMode('preview'));
  await expect(page.locator('.monaco-editor')).toHaveCount(0);
  await expect(preview.locator('h1')).toHaveText('unsaved update');
});

for (const renderer of ['preview', 'milkdown']) {
  test(`${renderer} HTML fenced code has an isolated live preview`, async ({ page }) => {
    const markdown = `\`\`\`html\n${html}\n\`\`\``;
    await page.goto(`/tests/preview-harness.html?renderer=${renderer}&content=${encodeURIComponent(markdown)}`);
    const preview = page.frameLocator('.html-preview__frame');
    await expect(preview.locator('h1')).toHaveText('Live HTML');
    await preview.locator('#count').click();
    await expect(preview.locator('#count')).toHaveText('clicked');
    if (renderer === 'milkdown') {
      await page.evaluate(() => window.trial.selectCode());
      await page.keyboard.insertText('<h1>Edited inside Milkdown</h1>');
      await expect(preview.locator('h1')).toHaveText('Edited inside Milkdown');
    }
  });
}
