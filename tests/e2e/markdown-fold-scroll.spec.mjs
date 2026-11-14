import { expect, test } from '@playwright/test';

function setMarkdownFolding(page, enabled) {
  return page.evaluate(async (value) => {
    (await import('/src/store/useConfigStore.js')).default.getState().setConfig('markdownFolding', value);
  }, enabled);
}

test('folds created in Milkdown are restored in Monaco on the first mode switch', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  const setMode = (mode) => page.evaluate(async (value) => {
    (await import('/src/store/useEditorStore.js')).default.getState().setViewMode(value);
  }, mode);
  await setMode('preview');
  await page.evaluate(async () => {
    const { default: store } = await import('/src/store/useEditorStore.js');
    store.getState().openFile({ path: '/first-fold.md', name: 'first-fold.md',
      content: '# Parent\n\n## Child\n\nHidden child\n\n## Sibling\n\nHidden sibling\n\n# Next\n\nVisible next' });
  });
  const milkdown = page.locator('.milkdown-editor');
  await milkdown.locator('h2').first().getByRole('button').click();
  await milkdown.locator('h1').first().getByRole('button').click();
  await expect(milkdown.getByText('Hidden sibling')).toBeHidden();
  await setMode('split');
  const preview = page.locator('.editor-content__preview--half');
  const parent = preview.getByRole('heading', { name: 'Parent', exact: true }).getByRole('button');
  await expect(parent).toHaveAttribute('aria-expanded', 'false', { timeout: 20000 });
  await expect(preview.getByText('Hidden sibling')).toBeHidden();
  await parent.click();
  await expect(preview.getByText('Hidden sibling')).toBeVisible();
  await expect(preview.getByText('Hidden child')).toBeHidden();
  await setMarkdownFolding(page, false);
  await setMode('preview');
  const child = milkdown.locator('h2').first().getByRole('button');
  await expect(child).toHaveAttribute('aria-expanded', 'false');
  await child.click();
  await expect(milkdown.getByText('Hidden child')).toBeVisible();
  await setMode('split');
  await expect(preview.getByText('Hidden child')).toBeVisible();
});

function foldGeometry(button) {
  return button.evaluate((control) => {
    const heading = control.parentElement;
    const pane = control.closest('.md-preview');
    const lineHeight = parseFloat(getComputedStyle(heading).lineHeight);
    const { width, height, left, right, top } = control.getBoundingClientRect();
    const headingBox = heading.getBoundingClientRect();
    const paneLeft = pane.getBoundingClientRect().left;
    return { width, height, lineHeight, gap: headingBox.left - right, topDelta: headingBox.top - top,
      leftInset: left - paneLeft, center: (left + right) / 2 - paneLeft };
  });
}

function expectHeadingArrows(first, second) {
  for (const arrow of [first, second]) {
    expect(Math.abs(arrow.height - arrow.lineHeight)).toBeLessThan(.1);
    expect(arrow.width).toBe(arrow.height);
    expect(arrow.gap).toBeGreaterThanOrEqual(3);
    expect(arrow.leftInset).toBeGreaterThanOrEqual(3);
    expect(arrow.topDelta).toBe(0);
  }
  expect(Math.abs(first.center - second.center)).toBeLessThan(.1);
  expect(first.height).toBeGreaterThan(second.height);
}

test('Milkdown folds a heading and keeps a nested heading folded after reopening it', async ({ page }) => {
  const source = '# Parent\n\nParent body\n\n## Child\n\nChild body\n\n## Later\n\nLater body\n\n```js\nconst item = 1;\n```\n\n# Next\n\nNext body';
  await page.goto(`/tests/milkdown-flow-harness.html?content=${encodeURIComponent(source)}`);
  const editor = page.locator('.milkdown-editor');
  const parent = editor.locator('h1').first();
  const child = editor.locator('h2').first();
  const body = editor.getByText('Child body');
  const codeFold = editor.locator('.moki-code-fold').getByRole('button', { includeHidden: true });
  expectHeadingArrows(await foldGeometry(parent.locator('button')), await foldGeometry(child.locator('button')));
  await child.locator('button').click();
  await expect(body).toBeHidden();
  await expect(child.locator('.md-preview__fold-ellipsis')).toBeVisible();
  await codeFold.click();
  await expect(codeFold).toHaveAttribute('aria-expanded', 'false');
  await parent.locator('button').click();
  await expect(child).toBeHidden();
  await expect(editor.getByText('Later body')).toBeHidden();
  await expect(codeFold).toBeHidden();
  await expect(editor.getByText('Next body')).toBeVisible();
  await parent.locator('button').click();
  await expect(child).toBeVisible();
  await expect(codeFold).toBeVisible();
  await expect(codeFold).toHaveAttribute('aria-expanded', 'false');
  await expect(body).toBeHidden();
  await child.locator('button').click();
  await expect(body).toBeVisible();
  await child.locator('button').click();
  await setMarkdownFolding(page, false);
  await expect(parent.locator('button')).toBeHidden();
  await expect(body).toBeHidden();
  await expect(child.locator('button')).toHaveAttribute('aria-expanded', 'false');
  await child.locator('button').click();
  await expect(body).toBeVisible();
  await expect(child.locator('button')).toBeHidden();
  await setMarkdownFolding(page, true);
  await expect(child.locator('button')).toHaveAttribute('aria-expanded', 'true');
  expect(await page.evaluate(() => window.trial.dirty())).toBe(false);
});

test('Milkdown folds ordered and unordered list children and a code block without changing the document', async ({ page }) => {
  const source = '1. Parent item\n   1. Child item\n2. Next item\n\n- Bullet parent\n  - Bullet child\n\n```rust\nlet n = 1;\n```\n\nAfter';
  await page.goto(`/tests/milkdown-flow-harness.html?content=${encodeURIComponent(source)}`);
  const editor = page.locator('.milkdown-editor');
  const item = editor.locator('ol > .md-preview__foldable-item');
  const itemFold = item.getByRole('button');
  await expect(itemFold).toHaveCSS('opacity', '0');
  await item.locator('p').first().hover();
  await expect(itemFold).toHaveCSS('opacity', '1');
  await itemFold.hover();
  await expect(itemFold).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  expect(await itemFold.evaluate((button) => getComputedStyle(button, '::before').opacity)).toBe('0.65');
  await itemFold.click();
  await expect(item.getByText('Child item')).toBeHidden();
  await expect(item.locator('.md-preview__fold-ellipsis')).toBeVisible();
  await expect(editor.getByText('Next item')).toBeVisible();
  await itemFold.click();
  await expect(item.getByText('Child item')).toBeVisible();
  const bullet = editor.locator('ul > .md-preview__foldable-item');
  await bullet.getByRole('button').click();
  await expect(bullet.getByText('Bullet child')).toBeHidden();
  await bullet.getByRole('button').click();
  await expect(bullet.getByText('Bullet child')).toBeVisible();

  const code = editor.locator('.milkdown-code-block');
  const codeFold = editor.locator('.moki-code-fold');
  await code.hover();
  await expect(codeFold.getByRole('button')).toHaveCSS('opacity', '1');
  await codeFold.getByRole('button').click();
  await expect(code).toBeHidden();
  await expect(codeFold.getByText('```rust')).toBeVisible();
  await expect(codeFold.locator('.md-preview__fold-ellipsis')).toBeVisible();
  await codeFold.getByRole('button').click();
  await expect(code).toBeVisible();
  expect(await page.evaluate(() => window.trial.dirty())).toBe(false);
});

test('Monaco and split Markdown share folds and synchronize scroll in both directions', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  await page.evaluate(async () => {
    const { default: store } = await import('/src/store/useEditorStore.js');
    const { default: config } = await import('/src/store/useConfigStore.js');
    config.getState().setConfig('previewZoomSync', false);
    const sections = Array.from({ length: 18 }, (_, i) =>
      `# Section ${i}\n\n${i === 0 ? '## Details\n\n' : ''}${`body for ${i}\n\n`.repeat(8)}`).join('\n');
    const source = `${sections}\n# Blocks\n\n\`\`\`text\nFenced content\n\`\`\`\n\n1. Parent item\n   1. Child item\n2. Next item\n\n<!-- #region -->\n\nRegion content\n\n<!-- #endregion -->\n`;
    store.getState().openFile({ path: '/fold.md', name: 'fold.md', content: source });
    store.getState().setViewMode('split');
  });
  const preview = page.locator('.editor-content__preview--half');
  const heading = preview.getByRole('heading', { name: 'Section 0', exact: true });
  const body = preview.getByText('body for 0', { exact: true }).first();
  const run = (action, line) => page.evaluate(async ({ action, line }) => {
    const monaco = await import('/node_modules/monaco-editor/esm/vs/editor/editor.main.js');
    const editor = monaco.editor.getEditors()[0];
    if (action === 'scroll') editor.setScrollTop(editor.getTopForLineNumber(line));
    else await editor.getAction(action).run({ selectionLines: [line] });
  }, { action, line });
  await expect(heading).toBeVisible();
  const button = heading.getByRole('button');
  const details = preview.getByRole('heading', { name: 'Details', exact: true }).getByRole('button');
  const originalPreview = await foldGeometry(button);
  expectHeadingArrows(originalPreview, await foldGeometry(details));
  await page.evaluate(async () => {
    const { default: config } = await import('/src/store/useConfigStore.js');
    config.getState().setConfig('previewFontSize', 22);
  });
  await expect.poll(async () => (await foldGeometry(button)).height).toBeGreaterThan(originalPreview.height);
  expectHeadingArrows(await foldGeometry(button), await foldGeometry(details));
  const monacoPane = page.locator('.editor-content__editor--half .monaco-editor');
  await expect(monacoPane).toBeVisible();
  const caret = monacoPane.locator('.cursors-layer > .cursor').first();
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const [theme, color] of [['dark', 'rgb(82, 139, 255)'], ['light', 'rgb(82, 111, 255)']]) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await expect(caret).toHaveCSS('background-color', color);
  }
  const gutter = monacoPane.locator('.codicon-folding-expanded').first();
  await expect(gutter).toHaveCSS('opacity', '0');
  await monacoPane.locator('.view-line').first().hover();
  await expect(gutter).toHaveCSS('opacity', '1');
  await gutter.hover();
  await expect(gutter).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const arrowGeometry = () => gutter.evaluate((icon) => {
    const glyph = getComputedStyle(icon, '::before');
    return { opacity: glyph.opacity, width: parseFloat(glyph.width), height: parseFloat(glyph.height),
      lineHeight: icon.parentElement.getBoundingClientRect().height };
  });
  const original = await arrowGeometry();
  expect(original).toEqual({ opacity: '0.65', width: original.lineHeight, height: original.lineHeight, lineHeight: original.lineHeight });
  const setLineHeight = (height) => page.evaluate(async (value) => {
    (await import('/src/store/useConfigStore.js')).default.getState().setConfig('lineHeight', value);
  }, height);
  const nextLineHeight = original.lineHeight + 8;
  await setLineHeight(nextLineHeight);
  await expect.poll(arrowGeometry).toEqual({ opacity: '0.65', width: nextLineHeight, height: nextLineHeight, lineHeight: nextLineHeight });
  await setLineHeight(original.lineHeight);
  await page.evaluate(() => {
    window.foldAnimations = [];
    document.addEventListener('animationstart', (event) => window.foldAnimations.push(event.animationName));
  });
  await run('editor.fold', 1);
  await expect(body).toBeHidden();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(heading.locator('.md-preview__fold-ellipsis')).toBeVisible();
  await button.click();
  await expect(body).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => page.evaluate(() => window.foldAnimations)).toEqual(expect.arrayContaining(['moki-fold-collapse', 'moki-fold-expand']));
  await run('editor.fold', 1);
  await expect(body).toBeHidden();
  await setMarkdownFolding(page, false);
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(button).toBeVisible();
  await expect(body).toBeHidden();
  await button.click();
  await expect(body).toBeVisible();
  await expect(button).toBeHidden();
  await run('editor.fold', 1);
  await expect(body).toBeHidden();
  await expect(button).toBeVisible();
  await run('editor.unfold', 1);
  await expect(body).toBeVisible();
  await expect(button).toBeHidden();
  await setMarkdownFolding(page, true);
  await expect(button).toBeVisible();
  const sourceLine = await preview.getByRole('heading', { name: 'Section 5', exact: true })
    .locator('..').getAttribute('data-md-start');
  await run('scroll', Number(sourceLine));
  const topDifference = (name) => preview.getByRole('heading', { name, exact: true }).locator('..')
    .evaluate((block) => block.getBoundingClientRect().top - block.parentElement.getBoundingClientRect().top);
  await expect.poll(async () => Math.abs(await topDifference('Section 5'))).toBeLessThan(3);
  const line = await preview.getByRole('heading', { name: 'Section 8', exact: true }).locator('..').evaluate((block) => {
    const pane = block.parentElement;
    pane.scrollTop += block.getBoundingClientRect().top - pane.getBoundingClientRect().top;
    return Number(block.dataset.mdStart);
  });
  await expect.poll(() => page.evaluate(async (line) => {
    const monaco = await import('/node_modules/monaco-editor/esm/vs/editor/editor.main.js');
    const editor = monaco.editor.getEditors()[0];
    return Math.abs(editor.getScrollTop() - editor.getTopForLineNumber(line));
  }, line)).toBeLessThan(3);
  const code = preview.getByText('Fenced content', { exact: true });
  const codeBlock = preview.locator('[data-md-code]');
  const codeLine = Number(await codeBlock.getAttribute('data-md-start'));
  await run('editor.fold', codeLine);
  await expect(code).toBeHidden();
  await expect(codeBlock.getByText('```text')).toBeVisible();
  await codeBlock.getByRole('button').click();
  await expect(code).toBeVisible();
  const item = preview.locator('.md-preview__foldable-item');
  const itemLine = Number(await item.getAttribute('data-md-item'));
  await run('editor.fold', itemLine);
  await expect(item.getByText('Child item')).toBeHidden();
  await expect(item.locator('.md-preview__fold-ellipsis')).toBeVisible();
  await item.getByRole('button').click();
  await expect(item.getByText('Child item')).toBeVisible();
  const region = preview.getByText('Region content', { exact: true });
  const regionContentLine = Number(await region.locator('..').getAttribute('data-md-start'));
  await run('editor.fold', regionContentLine - 2);
  await expect(region).toBeHidden();
  await run('editor.unfold', regionContentLine - 2);
  await expect(region).toBeVisible();
});
