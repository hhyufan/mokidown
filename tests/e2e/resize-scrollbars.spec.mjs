import { expect, test } from '@playwright/test';

test('scrollbar drags do not resize the sidebar or split editor; thin dividers still resize', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30_000 });
  await page.evaluate(async () => {
    const { default: editor } = await import('/src/store/useEditorStore.js');
    const { default: files } = await import('/src/store/useFileStore.js');
    const { default: config } = await import('/src/store/useConfigStore.js');
    config.getState().setConfig('autoSave', false);
    files.setState({ currentDir: '/scroll-test', files: Array.from({ length: 500 }, (_, index) => ({
      name: `note${index}.md`, path: `/scroll-test/note${index}.md`, is_dir: false,
    })), directoryIndex: null, directoryLoading: false, directoryError: '' });
    editor.getState().openFile({ name: 'scroll.md', path: '/scroll-test/scroll.md', content: Array.from({ length: 500 }, (_, index) => `Paragraph ${index} for scrolling.\n`).join('\n') });
    editor.getState().setViewMode('split');
    editor.getState().setSidebarVisible(true);
    editor.getState().setSidebarView('explorer');
  });
  const sidebar = page.locator('.sidebar');
  const files = page.locator('.file-tree__list');
  const resize = page.locator('.sidebar__resizer');
  const split = page.locator('.editor-content__split-divider');
  await expect(files).toBeVisible();
  await expect(page.locator('.monaco-editor .scrollbar.vertical > .slider').first()).toBeAttached({ timeout: 30_000 });
  await expect(resize).toHaveCSS('width', '3px');
  await expect(split).toHaveCSS('width', '3px');
  const before = await sidebar.boundingBox();
  const geometry = await files.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const handle = document.querySelector('.sidebar__resizer').getBoundingClientRect();
    const gutter = node.offsetWidth - node.clientWidth || parseFloat(getComputedStyle(node, '::-webkit-scrollbar').width);
    const x = box.right - gutter / 2;
    const y = box.top + 8;
    return { x, y, gap: handle.left - box.right, gutter, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight,
      target: document.elementFromPoint(x, y)?.className,
      targetIsResize: Boolean(document.elementFromPoint(x, y)?.closest('.sidebar__resizer')) };
  });
  console.log('scrollbar geometry', geometry);
  expect(geometry.gap).toBeGreaterThanOrEqual(-0.5);
  expect(geometry.targetIsResize).toBe(false);
  await page.mouse.move(geometry.x, geometry.y);
  await page.mouse.down();
  await page.mouse.move(geometry.x, geometry.y + 140, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => files.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  expect((await sidebar.boundingBox()).width).toBeCloseTo(before.width, 1);

  const handle = await resize.boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 60, handle.y + handle.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await sidebar.boundingBox()).width).toBeCloseTo(before.width + 60, 0);

  const bar = page.locator('.editor-content__editor--half .monaco-editor .scrollbar.vertical').first();
  await page.locator('.editor-content__editor--half').hover();
  await expect(bar).toHaveCSS('pointer-events', 'auto');
  const slider = bar.locator('> .slider');
  const thumb = await slider.boundingBox();
  const divider = await split.boundingBox();
  expect(thumb.x + thumb.width).toBeLessThanOrEqual(divider.x + 0.5);
  const initialRatio = Number(await split.getAttribute('aria-valuenow'));
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
  await page.mouse.down();
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2 + 100, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await slider.boundingBox()).y).toBeGreaterThan(thumb.y + 10);
  expect(Number(await split.getAttribute('aria-valuenow'))).toBe(initialRatio);

  const splitBox = await split.boundingBox();
  await page.mouse.move(splitBox.x + splitBox.width / 2, splitBox.y + 100);
  await page.mouse.down();
  await page.mouse.move(splitBox.x + splitBox.width / 2 + 60, splitBox.y + 100, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => Number(await split.getAttribute('aria-valuenow'))).toBeGreaterThan(initialRatio);
  await split.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(split).toHaveAttribute('aria-orientation', 'vertical');
});

test('Monaco and the split preview fill their panes through drag, viewport and mode changes', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 45000 });
  let releasePreview;
  const previewGate = new Promise((resolve) => { releasePreview = resolve; });
  await page.route('**/src/components/editor/MarkdownPreview.jsx*', async (route) => {
    await previewGate;
    await route.continue();
  });
  await page.evaluate(async () => {
    const { default: store } = await import('/src/store/useEditorStore.js');
    store.getState().openFile({
      path: '/resize.md', name: 'resize.md',
      content: '# Resize preview\n\n' + 'Words that wrap as the viewport changes. '.repeat(80),
    });
    store.getState().setSidebarVisible(false);
    store.getState().setViewMode('split');
  });
  const divider = page.getByRole('separator', { name: /split|分屏/i });
  const container = page.locator('.monaco-editor-container');
  try {
    await expect(container.locator('.view-lines')).toContainText('Resize preview');
    await expect(page.locator('.editor-content__workspace--split')).toHaveCount(0);
  } finally {
    releasePreview();
  }
  await expect(page.locator('.md-preview h1')).toHaveText(/Resize preview/);
  const verifyPanes = async () => {
    await expect.poll(() => page.evaluate(() => {
      const workspace = document.querySelector('.editor-content__workspace--split');
      const pane = workspace.querySelector('.monaco-editor-container');
      const widget = pane.querySelector('.monaco-editor');
      const preview = workspace.querySelector('.editor-content__preview');
      const track = workspace.querySelector('.editor-content__split-divider');
      const vertical = getComputedStyle(workspace).gridTemplateRows.split(' ').length === 3;
      const axis = vertical ? 'height' : 'width';
      const length = (element) => element.getBoundingClientRect()[axis];
      return [
        Math.abs(pane.clientWidth - widget.clientWidth),
        Math.abs(pane.clientHeight - widget.clientHeight),
        Math.abs(length(workspace) - length(pane) - length(preview) - length(track)),
      ].every((difference) => difference <= 1);
    })).toBe(true);
  };
  await verifyPanes();
  await container.evaluate((node) => { window.resizeMonaco = node.querySelector('.monaco-editor'); });
  await page.locator('.editor-content__preview--half').evaluate((node) => { window.resizePreview = node; });
  const box = await divider.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 40);
  await verifyPanes();
  await page.mouse.move(box.x - 60, box.y + 40);
  await page.mouse.up();
  await verifyPanes();

  for (const width of [900, 1350, 650, 1050]) {
    await page.setViewportSize({ width, height: 680 });
    await expect(divider).toHaveAttribute('aria-orientation', width <= 768 ? 'horizontal' : 'vertical');
    await verifyPanes();
  }
  await page.evaluate(async () => {
    const { default: store } = await import('/src/store/useEditorStore.js');
    store.getState().setViewMode('edit');
  });
  await expect(divider).toBeHidden();
  expect(await container.evaluate((node) => node.querySelector('.monaco-editor') === window.resizeMonaco)).toBe(true);
  await page.evaluate(async () => {
    (await import('/src/store/useEditorStore.js')).default.getState().setViewMode('split');
  });
  await verifyPanes();
  expect(await page.locator('.editor-content__preview--half').evaluate((node) => node === window.resizePreview)).toBe(true);
});
