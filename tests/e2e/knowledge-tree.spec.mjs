import { expect, test } from '@playwright/test';

async function expectAlignedSwitcher(tree) {
  const switcher = tree.locator('.ant-tree-switcher:not(.ant-tree-switcher-noop)').first();
  await switcher.hover();
  const geometry = await switcher.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const icon = element.querySelector('.ant-tree-switcher-line-icon').getBoundingClientRect();
    const background = getComputedStyle(element, '::before');
    const connector = getComputedStyle(element, '::after');
    return {
      iconCenter: icon.top - box.top + icon.height / 2,
      backgroundCenter: parseFloat(background.top) + parseFloat(background.height) / 2,
      connectorCenter: parseFloat(connector.top),
      connectorWidth: box.width - parseFloat(connector.insetInlineStart),
      iconWidth: icon.width,
    };
  });
  expect(Math.abs(geometry.iconCenter - geometry.backgroundCenter)).toBeLessThan(0.5);
  expect(Math.abs(geometry.iconCenter - geometry.connectorCenter - 0.5)).toBeLessThan(0.5);
  expect(Math.abs(geometry.connectorWidth - geometry.iconWidth / 2)).toBeLessThan(0.5);
}

async function openDocument(page, mode = 'split') {
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  await page.evaluate(async ({ mode }) => {
    const { default: store } = await import('/src/store/useEditorStore.js');
    const { default: config } = await import('/src/store/useConfigStore.js');
    config.getState().setConfig('autoSave', false);
    let callback = 0;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => ++callback,
      unregisterCallback() {},
      invoke: async (command, args) => {
        if (command === 'read_file_content') return args.path.replace(/\\/g, '/') === 'C:/notes/lesson.mgtree'
          ? { success: true, content: 'Learning map\n  First example >js[1]\n  Second example >js++\n  Missing example >js[9]' }
          : { success: false };
        if (command.startsWith('plugin:event|')) return 1;
        return [];
      },
    };
    const content = '# Lesson\n\n```tree\nInline map\n  Inline second >javascript[2]\n```\n\n```js\nconsole.log("first");\n```\n\n'
      + Array.from({ length: 50 }, (_, n) => `Paragraph ${n}: example text.\n\n`).join('')
      + '```javascript\nconsole.log("second");\n```';
    store.getState().openFile({ path: 'C:/notes/lesson.md', name: 'lesson.md', content });
    store.getState().setViewMode(mode);
    store.getState().setSidebarVisible(true);
    window.treeTrial = { store };
  }, { mode });
}

test('companion and inline trees navigate language indexes, and sidebar resizing persists', async ({ page }) => {
  await openDocument(page);
  await expect(page.locator('.md-preview pre[data-code-language="javascript"]')).toHaveCount(2);
  await page.locator('.sidebar__tab').filter({ hasText: /知识树|Knowledge tree/ }).click();
  const sidebar = page.locator('.sidebar');
  await expect(sidebar).toContainText('Learning map');
  await expect(sidebar).toContainText('Inline map');
  await sidebar.getByText('Second example', { exact: false }).click();
  const target = page.locator('.md-preview pre.knowledge-tree-target');
  await expect(target).toContainText('console.log("second")');
  await expect.poll(() => target.evaluate((element) => {
    const panel = element.closest('.md-preview').getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return box.top >= panel.top && box.bottom <= panel.bottom;
  })).toBe(true);
  expect(await target.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('none');
  expect(await target.evaluate((element) => getComputedStyle(element, '::after').boxShadow)).toMatch(/0px 0px 0px 1px inset/);
  await expect(sidebar.locator('.moki-tree__node--jumping')).toContainText('Second example');
  await expect(sidebar.locator('.ant-tree-node-selected')).toHaveCount(0);
  await sidebar.getByText('First example', { exact: false }).click();
  await expect(target).toContainText('console.log("first")');
  const initialWidth = await sidebar.evaluate((element) => element.getBoundingClientRect().width);
  const divider = page.getByRole('separator', { name: /调整侧栏|Resize sidebar/ });
  const rect = await divider.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 + 110, rect.y + rect.height / 2, { steps: 8 });
  await page.mouse.up();
  const maximumWidth = Number(await divider.getAttribute('aria-valuemax'));
  await expect.poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().width)).toBeCloseTo(Math.min(initialWidth + 110, maximumWidth), 0);
  await divider.focus();
  await page.keyboard.press('ArrowLeft');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mokidown-editor')).state.sidebarWidth)).toBeGreaterThan(280);
  await divider.dblclick();
  const minimumWidth = Number(await divider.getAttribute('aria-valuemin'));
  await expect.poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().width)).toBe(Math.max(280, minimumWidth));
  const companion = sidebar.locator('.knowledge-tree').filter({ hasText: 'Learning map' });
  await expect(companion.locator('.knowledge-tree__header').getByRole('button')).toHaveCount(3);
  expect(await companion.locator('.knowledge-tree__header').evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    blur: getComputedStyle(element).backdropFilter,
  }))).toEqual({ background: 'rgba(0, 0, 0, 0)', blur: 'none' });
  await expect(companion.locator('[data-icon="minus-square"]')).toBeVisible();
  await expectAlignedSwitcher(companion);
  await expect(companion.locator('[data-icon="folder"], [data-icon="folder-open"], [data-icon="file-text"]')).toHaveCount(0);
  await companion.getByRole('button', { name: /Collapse all|全部折叠|折叠全部/ }).click();
  await expect(companion.locator('[data-icon="plus-square"]')).toBeVisible();
  await expect(companion.getByRole('button', { name: 'Second example', exact: true })).toHaveCount(0);
  await companion.getByRole('button', { name: /Expand all|全部展开|展开全部/ }).click();
  await expect(companion.getByRole('button', { name: 'Second example', exact: true })).toBeVisible();
  await companion.getByRole('button', { name: /Open tree editor|打开树编辑器/ }).click();
  await expect(page.locator('.editor-content__preview.moki-tree')).toBeVisible();
  await page.locator('.editor-content__preview.moki-tree').getByRole('button', { name: /Expand all|全部展开|展开全部/ }).click();
  await expect(page.locator('.editor-content__preview .moki-tree__node--linked').first().locator('.moki-tree__reference')).toHaveText('js1');
  await expect(page.locator('.editor-content__preview [data-icon="minus-square"]')).toBeVisible();
  await expectAlignedSwitcher(page.locator('.editor-content__preview.moki-tree'));
  await expect(page.locator('.editor-content__preview [data-icon="folder"], .editor-content__preview [data-icon="file-text"]')).toHaveCount(0);
});

test('collapsed root siblings retain their guides and tree icons scale with text', async ({ page }) => {
  await openDocument(page, 'preview');
  await page.evaluate(() => {
    window.treeTrial.store.getState().openFile({ path: 'C:/notes/root-links.mgtree', name: 'root-links.mgtree',
      content: 'First\n  One >js[1]\nSecond\n  Two\nThird\n  Three' });
    window.treeTrial.store.getState().setViewMode('preview');
  });
  const tree = page.locator('.editor-content__preview.moki-tree');
  await expect(tree.locator('[data-icon="plus-square"]')).toHaveCount(3);
  const sizes = await tree.locator('.moki-tree__root > .ant-tree-switcher').evaluateAll((elements) => elements.map((element) => ({
    image: getComputedStyle(element).backgroundImage,
    size: getComputedStyle(element).backgroundSize,
  })));
  expect(sizes.every((item) => item.image.includes('linear-gradient'))).toBe(true);
  expect(sizes[0].size).toMatch(/^0px 0px, 1px/);
  expect(sizes[1].size).toMatch(/^1px .+, 1px/);
  expect(sizes[2].size).toMatch(/, 0px 0px$/);
  await expectAlignedSwitcher(tree);
  const before = await tree.locator('.ant-tree-switcher-line-icon').first().boundingBox();
  await tree.getByRole('button', { name: /Expand all|全部展开|展开全部/ }).click();
  const codeBefore = await tree.locator('.moki-tree__icon').first().boundingBox();
  await page.evaluate(async () => {
    const { default: config } = await import('/src/store/useConfigStore.js');
    const current = config.getState().previewFontSize || config.getState().fontSize || 14;
    config.getState().setConfig('previewFontSize', current * 2);
  });
  await expect.poll(async () => (await tree.locator('.ant-tree-switcher-line-icon').first().boundingBox()).width).toBeCloseTo(before.width * 2, 0);
  expect((await tree.locator('.moki-tree__icon').first().boundingBox()).width).toBeCloseTo(codeBefore.width * 2, 0);
  await expectAlignedSwitcher(tree);
  await tree.getByRole('button', { name: /Collapse all|全部折叠|折叠全部/ }).click();
  await expect(tree.locator('[data-icon="plus-square"]')).toHaveCount(3);
  await tree.screenshot({ path: '.cache/knowledge-tree-root-guides.png' });
});

test('Milkdown inline and sidebar jumps highlight code without switching modes', async ({ page }) => {
  await openDocument(page, 'preview');
  const inlineTree = page.locator('.milkdown-knowledge-tree .knowledge-tree');
  await expect(inlineTree).toContainText('Inline map', { timeout: 30000 });
  await inlineTree.getByText('Inline second', { exact: false }).click();
  const target = page.locator('.md-preview--milkdown .knowledge-tree-target');
  await expect(target).toBeVisible();
  await expect(target).toContainText('console.log("second")');
  expect(await page.evaluate(() => window.treeTrial.store.getState().viewMode)).toBe('preview');
  await page.locator('.sidebar__tab').filter({ hasText: /知识树|Knowledge tree/ }).click();
  await page.locator('.sidebar').getByRole('button', { name: 'First example', exact: true }).click();
  await expect(target).toContainText('console.log("first")');
  expect(await target.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('none');
  await expect.poll(() => target.evaluate((element) => {
    const panel = element.closest('.md-preview').getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return box.top >= panel.top && box.bottom <= panel.bottom;
  })).toBe(true);
  await expect(page.locator('.sidebar .moki-tree__node--jumping')).toContainText('First example');
  expect(await page.evaluate(() => window.treeTrial.store.getState().viewMode)).toBe('preview');
  await page.screenshot({ path: '.cache/knowledge-tree-milkdown.png' });
  await expect(target).toHaveCount(0, { timeout: 6000 });
  await expect(page.locator('.sidebar .moki-tree__node--jumping')).toHaveCount(0);
});

test('nested branch and leaf guides stay connected through expanded and wrapped rows', async ({ page }) => {
  await openDocument(page, 'preview');
  await page.evaluate(() => {
    window.treeTrial.store.getState().openFile({ path: 'C:/notes/nested.mgtree', name: 'nested.mgtree',
      content: 'Root A\n  Leaf A\n  Branch B\n    Nested leaf\n    Nested branch\n      Deep leaf\n    Another leaf\n  A deliberately long node title that wraps across several lines to verify continuous guides and aligned symbols >js[1]\nRoot B\n  Child B\nRoot C\n  Child C' });
    window.treeTrial.store.getState().setViewMode('preview');
  });
  const tree = page.locator('.editor-content__preview.moki-tree');
  await tree.getByRole('button', { name: /Expand all|全部展开|展开全部/ }).click();
  // Limit the canvas width to exercise wrapping without changing the app layout.
  await tree.locator('.moki-tree__canvas').evaluate((element) => { element.style.width = '420px'; element.style.minWidth = '0'; });
  const geometry = await tree.locator('.ant-tree-treenode:not([aria-hidden])').evaluateAll((rows) => rows.map((row) => {
    const switcher = row.querySelector(':scope > .ant-tree-switcher');
    const box = row.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, guides: getComputedStyle(switcher).backgroundImage,
      activeAncestors: [...row.querySelectorAll('.ant-tree-indent-unit:not(.ant-tree-indent-unit-end)')].map((unit) => ({
        height: unit.getBoundingClientRect().height, rowHeight: box.height,
        line: getComputedStyle(unit, '::before').backgroundColor,
      })) };
  }));
  expect(geometry).toHaveLength(12);
  for (const [index, row] of geometry.entries()) {
    expect(row.guides).toContain('linear-gradient');
    if (index) expect(Math.abs(row.top - geometry[index - 1].bottom)).toBeLessThan(1);
    for (const ancestor of row.activeAncestors) {
      expect(ancestor.height).toBeCloseTo(ancestor.rowHeight, 0);
      expect(ancestor.line).not.toBe('rgba(0, 0, 0, 0)');
    }
  }
  await tree.screenshot({ path: '.cache/knowledge-tree-nested-guides.png' });
});

test('tree editing preserves rendered code, typography and independent jump metadata', async ({ page }) => {
  await openDocument(page, 'preview');
  await page.evaluate(async () => {
    const { default: config } = await import('/src/store/useConfigStore.js');
    config.getState().setConfig('previewFontSize', 24);
    window.treeTrial.store.getState().openFile({ path: 'C:/notes/rename.mgtree', name: 'rename.mgtree',
      content: 'Use `Runtime.exec` to start a process >java++' });
    window.treeTrial.store.getState().setViewMode('preview');
  });
  const tree = page.locator('.editor-content__preview.moki-tree');
  const title = tree.getByRole('button', { name: 'Use Runtime.exec to start a process', exact: true });
  const before = await title.evaluate((element) => ({ font: getComputedStyle(element).fontSize, lineHeight: getComputedStyle(element).lineHeight,
    width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }));
  await title.click();
  const input = tree.getByRole('textbox', { name: /Edit node|编辑节点/ });
  await expect(input).toHaveText('Use Runtime.exec to start a process');
  await expect(input.locator('code')).toHaveText('Runtime.exec');
  await expect(input).not.toContainText('>java');
  await expect(tree.locator('.moki-tree__reference')).toHaveText('java1');
  const after = await input.evaluate((element) => ({ font: getComputedStyle(element).fontSize, lineHeight: getComputedStyle(element).lineHeight,
    border: getComputedStyle(element).borderTopWidth, shadow: getComputedStyle(element).boxShadow, background: getComputedStyle(element).backgroundColor,
    width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }));
  expect(after.font).toBe(before.font);
  expect(after.lineHeight).toBe(before.lineHeight);
  expect(after.width).toBeGreaterThanOrEqual(before.width - 1);
  expect(after.height).toBeGreaterThanOrEqual(before.height - 1);
  expect(after.border).toBe('0px');
  expect(after.shadow).toBe('none');
  expect(after.background).toBe('rgba(0, 0, 0, 0)');
  await tree.screenshot({ path: '.cache/knowledge-tree-inline-rename.png' });
  await input.fill('Updated process');
  await input.press('Control+a');
  await input.press('Control+e');
  await expect(input.locator('code')).toHaveText('Updated process');
  await input.press('Control+z');
  await expect(input.locator('code')).toHaveCount(0);
  await input.press('Control+Shift+z');
  await expect(input.locator('code')).toHaveText('Updated process');
  await input.press('Enter');
  await expect(tree.getByRole('button', { name: 'Updated process', exact: true })).toBeVisible();
  await expect(tree.getByRole('button', { name: 'Updated process', exact: true }).locator('code')).toHaveText('Updated process');
  await expect(tree.locator('.moki-tree__reference')).toHaveText('java1');
  expect(await page.evaluate(async () => {
    const { getBuffer } = await import('/src/utils/editorBuffer.js');
    return getBuffer('C:/notes/rename.mgtree');
  })).toBe('`Updated process` >java++');
});

test('sidebar tabs animate file-type changes, hide unsupported outline and share the mgtree icon', async ({ page }) => {
  await openDocument(page, 'preview');
  const list = page.getByRole('tablist');
  const knowledge = list.getByRole('tab', { name: /Knowledge tree|知识树/ });
  await expect(knowledge).toBeVisible();
  // The actual file icon component supplies the same SVG used by mgtree tabs.
  await expect(knowledge.locator('svg')).toBeVisible();
  await expect(knowledge.locator('.sidebar__knowledge-icon svg[class="@Tree"]')).toBeVisible();
  await knowledge.click();
  await expect.poll(() => knowledge.evaluate((element) => {
    const color = getComputedStyle(element).color;
    const shapes = [...element.querySelectorAll('svg path, svg rect, svg circle, svg polygon')]
      .filter((shape) => getComputedStyle(shape).fill !== 'none');
    return shapes.length > 0 && shapes.every((shape) => getComputedStyle(shape).fill === color);
  })).toBe(true);
  await list.getByRole('tab', { name: /Outline|大纲/ }).click();
  await page.evaluate(() => {
    window.treeTrial.store.getState().openFile({ path: 'C:/notes/main.java', name: 'main.java', content: 'class Main {}' });
  });
  await expect(list.getByRole('tab', { name: /Outline|大纲/ })).toHaveCount(0);
  await expect(list.getByRole('tab', { name: /Knowledge tree|知识树/ })).toHaveCount(0);
  await expect(list.getByRole('tab', { name: /Files|文件/ })).toHaveAttribute('aria-selected', 'true');
  const hidden = page.locator('.sidebar__tab-slot--hidden');
  await expect(hidden).toHaveCount(2);
  expect(await hidden.first().evaluate((element) => getComputedStyle(element).transitionProperty)).toContain('flex-grow');
  await expect.poll(() => hidden.first().evaluate((element) => element.getBoundingClientRect().width)).toBeLessThan(1);
  const codeMinimum = await page.evaluate(() => window.treeTrial.store.getState().sidebarMinWidth);
  await page.evaluate(() => window.treeTrial.store.getState().setActiveTab('C:/notes/lesson.md'));
  await expect(list.getByRole('tab', { name: /Outline|大纲/ })).toBeVisible();
  await expect(knowledge).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.treeTrial.store.getState().sidebarMinWidth)).toBeGreaterThan(codeMinimum);
  const divider = page.getByRole('separator', { name: /调整侧栏|Resize sidebar/ });
  await divider.focus();
  await page.keyboard.press('Home');
  await expect.poll(() => list.getByRole('tab').evaluateAll((buttons) => buttons.every((button) => {
    const label = button.lastElementChild;
    return label.scrollWidth <= label.clientWidth + 1;
  }))).toBe(true);
  await page.evaluate(async () => { const { default: i18n } = await import('/src/i18n/index.js'); await i18n.changeLanguage('zh'); });
  await expect(list.getByRole('tab', { name: '知识树' })).toBeVisible();
  await divider.focus();
  await page.keyboard.press('Home');
  await expect.poll(() => list.getByRole('tab').evaluateAll((buttons) => buttons.every((button) => {
    return button.lastElementChild.scrollWidth <= button.lastElementChild.clientWidth + 1;
  }))).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('.sidebar__tab-slot').first().evaluate((element) => getComputedStyle(element).transitionDuration)).toBe('0s');
});

test('visual jump settings edit all reference modes without exposing title source', async ({ page }) => {
  await openDocument(page, 'preview');
  await page.evaluate(() => {
    window.treeTrial.store.getState().openFile({ path: 'C:/notes/jumps.mgtree', name: 'jumps.mgtree', content: 'Run `demo` >java++' });
    window.treeTrial.store.getState().setViewMode('preview');
  });
  const tree = page.locator('.editor-content__preview.moki-tree');
  const source = () => page.evaluate(async () => {
    const { getBuffer } = await import('/src/utils/editorBuffer.js');
    return getBuffer('C:/notes/jumps.mgtree');
  });
  const popup = page.locator('.ant-popover:not(.ant-popover-hidden)');
  const chooseMode = async (name) => {
    await popup.getByRole('radio', { name, exact: true }).check();
  };
  for (const [mode, suffix, numeric] of [
    ['Block number', '>python[3]', 'Number'],
    ['Skip ahead', '>python+=3', 'Step'],
    ['Same block', '>python'],
    ['Next block', '>python++'],
    ['Remove jump', ''],
  ]) {
    await tree.getByRole('button', { name: 'Edit code jump', exact: true }).click();
    if (!suffix) {
      await popup.getByRole('button', { name: 'Remove jump', exact: true }).click();
      await expect.poll(source).toBe('Run `demo`');
      continue;
    }
    await chooseMode(mode);
    if (suffix) await popup.getByRole('combobox', { name: 'Code language' }).fill('python');
    if (numeric) await popup.getByRole('spinbutton', { name: numeric }).fill('3');
    await popup.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect.poll(source).toBe(`Run \`demo\`${suffix ? ` ${suffix}` : ''}`);
    await expect(tree.locator('.moki-tree__title code')).toHaveText('demo');
  }
  await tree.locator('.moki-tree__node').hover();
  await tree.getByRole('button', { name: 'Add code jump', exact: true }).click();
  await chooseMode('Block number');
  await popup.getByRole('combobox', { name: 'Code language' }).fill('js');
  await popup.getByRole('spinbutton').fill('2');
  await popup.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(source).toBe('Run `demo` >js[2]');

  await tree.getByRole('button', { name: 'Run demo', exact: true }).click();
  const input = tree.getByRole('textbox', { name: 'Edit node' });
  await input.fill('Type ');
  await input.press('End');
  await input.pressSequentially('`code`');
  await expect(input).toHaveText('Type code');
  await expect(input.locator('code')).toHaveText('code');
  expect(await input.locator('code').evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.marginLeft, style.marginRight, style.paddingLeft, style.paddingRight, style.color === getComputedStyle(element.parentElement).color];
  })).toEqual(['4px', '4px', '4px', '4px', true]);
  await input.press('Enter');
  await expect.poll(source).toBe('Type `code` >js[2]');

  // Opening metadata while a title is being edited must save the text first.
  await tree.getByRole('button', { name: 'Type code', exact: true }).click();
  await input.fill('Pending title');
  await tree.getByRole('button', { name: 'Edit code jump', exact: true }).click();
  await chooseMode('Next block');
  await popup.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(source).toBe('Pending title >js++');
});

test('jump popups are exclusive and reuse the opaque wallpaper surface in both themes', async ({ page }) => {
  await openDocument(page, 'preview');
  await page.evaluate(async () => {
    const { saveBackgroundImage } = await import('/src/utils/backgroundImage.js');
    const { default: config } = await import('/src/store/useConfigStore.js');
    const id = await saveBackgroundImage(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#82a8bc"/><circle cx="400" cy="300" r="240" fill="#bc9abd"/></svg>'], { type: 'image/svg+xml' }));
    config.getState().setConfig('backgroundImage', id);
    config.getState().setConfig('backgroundEnabled', true);
    window.treeTrial.store.getState().openFile({ path: 'C:/notes/exclusive.mgtree', name: 'exclusive.mgtree', content: 'First >java++\nSecond >python[2]' });
    window.treeTrial.store.getState().setViewMode('preview');
  });
  await expect(page.locator('body')).toHaveClass(/moki-has-background/);
  const tree = page.locator('.editor-content__preview.moki-tree');
  const triggers = tree.getByRole('button', { name: 'Edit code jump', exact: true });
  const visible = page.locator('.moki-tree-jump-popup:visible');
  await triggers.nth(0).click();
  await expect(visible).toHaveCount(1);
  await expect(visible.getByRole('combobox')).toHaveValue('java');
  await triggers.nth(1).click();
  await expect(visible).toHaveCount(1);
  await expect(visible.getByRole('combobox')).toHaveValue('python');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(async (value) => {
      const { default: store } = await import('/src/store/useThemeStore.js');
      store.getState().setTheme(value);
    }, theme);
    await expect.poll(() => visible.locator('.ant-popover-inner').evaluate((element) => {
      const style = getComputedStyle(element);
      const context = document.createElement('canvas').getContext('2d');
      context.fillStyle = style.backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return { alpha: context.getImageData(0, 0, 1, 1).data[3], wallpaper: style.backgroundImage.includes('blob:'),
        aligned: element.style.getPropertyValue('--moki-popup-x') !== '', opacity: style.opacity, blur: style.backdropFilter };
    })).toEqual({ alpha: 255, wallpaper: true, aligned: true, opacity: '1', blur: 'none' });
    await page.screenshot({ path: `.cache/tree-jump-popup-${theme}.png` });
  }
  await visible.getByRole('combobox').focus();
  await page.keyboard.press('Escape');
  await expect(visible).toHaveCount(0);
});

test('knowledge headers stay outside the tree scrollbar and show aligned wallpaper', async ({ page }) => {
  await openDocument(page, 'preview');
  await page.evaluate(async () => {
    const store = window.treeTrial.store.getState();
    store.openFile({ path: 'C:/notes/lesson.mgtree', name: 'lesson.mgtree',
      content: 'Examples\n' + Array.from({ length: 100 }, (_, index) => `  Example ${index + 1} >js[1]`).join('\n') });
    store.setActiveTab('C:/notes/lesson.md');
  });
  await page.getByRole('tab', { name: /Knowledge tree|知识树/ }).click();
  const tree = page.locator('.sidebar .knowledge-tree').filter({ has: page.locator('.knowledge-tree__heading', { hasText: 'lesson.mgtree' }) });
  await expect(tree.getByRole('button', { name: 'Example 100', exact: true })).toBeVisible();
  const header = tree.locator('.knowledge-tree__header');
  const list = page.locator('.sidebar .knowledge-tree__list');
  const top = await header.evaluate((element) => element.getBoundingClientRect().top);
  await tree.locator('.moki-tree__scroll').evaluate((element) => { element.scrollTop = 220; });
  expect(await header.evaluate((element) => element.getBoundingClientRect().top)).toBeCloseTo(top, 0);
  expect(await list.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  expect(await tree.locator('.moki-tree__scroll').evaluate((element) => element.getBoundingClientRect().top
    >= element.previousElementSibling.getBoundingClientRect().bottom)).toBe(true);
  await page.evaluate(async () => {
    const { saveBackgroundImage } = await import('/src/utils/backgroundImage.js');
    const { default: config } = await import('/src/store/useConfigStore.js');
    const id = await saveBackgroundImage(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#8ca7c0"/></svg>'], { type: 'image/svg+xml' }));
    config.getState().setConfig('backgroundImage', id);
    config.getState().setConfig('backgroundEnabled', true);
  });
  await expect.poll(() => header.evaluate((element) => {
    const style = getComputedStyle(element);
    const context = document.createElement('canvas').getContext('2d');
    context.fillStyle = style.backgroundColor; context.fillRect(0, 0, 1, 1);
    return { opaque: context.getImageData(0, 0, 1, 1).data[3] === 255,
      wallpaper: style.backgroundImage.includes('blob:'), aligned: element.style.getPropertyValue('--moki-popup-y') !== '' };
  })).toEqual({ opaque: true, wallpaper: true, aligned: true });
  const badge = tree.locator('.moki-tree__reference').nth(10);
  await badge.hover();
  await expect(page.getByRole('tooltip')).toHaveText(/Go to javascript code block 1|Go to js code block 1|跳到 js 的第 1 个代码块/);
  await expect(page.locator('.sidebar [title]')).toHaveCount(0);
  await page.screenshot({ path: '.cache/knowledge-tree-header-surface.png' });
});
