import { expect, test } from '@playwright/test';

test('Markdown preview replaces authored and generated native titles with Antd tooltips', async ({ page }) => {
  const content = '[link](https://example.com "Link help")\n\n<abbr title="Application programming interface">API</abbr>\n\n```css\nbody { color: red; }\n```';
  await page.goto(`/tests/preview-harness.html?content=${encodeURIComponent(content)}`);
  const preview = page.locator('.md-preview');
  const link = preview.getByRole('link', { name: 'link', exact: true });
  await link.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Link help');
  await expect(link).not.toHaveAttribute('title');
  await preview.locator('abbr').hover();
  await expect(page.getByRole('tooltip')).toHaveText('Application programming interface');
  await preview.locator('.lang-tag').hover();
  await expect(page.getByRole('tooltip')).toHaveText('Copy code');
  await expect(preview.locator('[title]:not(iframe)')).toHaveCount(0);
  await page.evaluate(async () => {
    const { setBuffer } = await import('/src/utils/editorBuffer.js');
    setBuffer('surface.md', '[link](https://example.com)');
  });
  await expect(link).not.toHaveAttribute('data-moki-tooltip');
});

test('Milkdown title tooltips keep authored link and image metadata in Markdown', async ({ page }) => {
  const image = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MCIgaGVpZ2h0PSI0MCI+PHJlY3Qgd2lkdGg9IjgwIiBoZWlnaHQ9IjQwIiBmaWxsPSJza3libHVlIi8+PC9zdmc+';
  const content = `[link](https://example.com "Link help")\n\n![sample](${image} "Image note")\n`;
  await page.goto(`/tests/milkdown-flow-harness.html?content=${encodeURIComponent(content)}`);
  const editor = page.locator('.milkdown-editor');
  await editor.getByRole('link', { name: 'link', exact: true }).hover();
  await expect(page.getByRole('tooltip')).toHaveText('Link help');
  await editor.getByRole('img', { name: 'sample' }).hover();
  await expect(page.getByRole('tooltip')).toHaveText('Image note');
  await expect(editor.locator('[title]:not(iframe)')).toHaveCount(0);
  const markdown = await page.evaluate(() => window.trial.markdown());
  expect(markdown).toContain('"Link help"');
  expect(markdown).toContain('"Image note"');
});

test('runtime title attributes use Tooltip while iframe accessible names remain intact', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible();
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.id = 'runtime-tooltip'; button.textContent = 'Runtime control'; button.title = 'Runtime hint';
    Object.assign(button.style, { position: 'fixed', top: '180px', left: '700px', zIndex: '100' });
    document.body.append(button);
    const frame = document.createElement('iframe'); frame.hidden = true; frame.title = 'Embedded document';
    document.body.append(frame);
  });
  const control = page.locator('#runtime-tooltip');
  await expect(control).not.toHaveAttribute('title');
  await control.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Runtime hint');
  await expect(page.locator('iframe[title="Embedded document"]')).toHaveCount(1);
});
