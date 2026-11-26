import { test, expect } from '@playwright/test';

async function setup(page) {
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  await page.evaluate(async () => {
    const { preloadMonacoEditor } = await import('/src/utils/monacoRuntimeBoot.js');
    await preloadMonacoEditor();
    const { default: store } = await import('/src/store/useEditorStore.js');
    const { default: config } = await import('/src/store/useConfigStore.js');
    const monaco = await import('/node_modules/monaco-editor/esm/vs/editor/editor.main.js');
    config.getState().setConfig('autoSave', false);
    config.getState().setConfig('wordWrap', true);
    store.getState().openFile({ path: '/wrapping.md', name: 'wrapping.md', content: '# Short text' });
    window.wrappingTrial = { store, config, monaco };
  });
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('Short text');
  await page.locator('.monaco-editor').hover();
}

async function horizontalVisible(page) {
  return page.locator('.monaco-editor .scrollbar.horizontal').evaluateAll((bars) =>
    bars.some((bar) => {
      const style = getComputedStyle(bar);
      return bar.getBoundingClientRect().height > 0 && style.display !== 'none'
        && style.visibility !== 'hidden' && Number(style.opacity) > 0;
    }));
}

test('word wrap removes the horizontal scrollbar across long lines, resizing and split view', async ({ page }) => {
  await setup(page);
  await expect.poll(() => horizontalVisible(page)).toBe(false);
  await page.evaluate(() => {
    const { store } = window.wrappingTrial;
    store.getState().replaceTabContent('/wrapping.md', { content:
      '# Wide document\n' + 'long-unbroken-identifier'.repeat(180) + '\n' + '\t'.repeat(25) + '中文🙂abc '.repeat(150) });
  });
  for (const [width, split] of [[1200, false], [900, true], [1500, true], [800, false]]) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate((split) => window.wrappingTrial.store.getState().setViewMode(split ? 'split' : 'edit'), split);
    await expect(page.locator('.monaco-editor .view-lines')).toBeVisible();
    await page.locator('.monaco-editor').hover();
    await expect.poll(() => horizontalVisible(page)).toBe(false);
    await expect.poll(() => page.evaluate(() => {
      const { monaco } = window.wrappingTrial;
      const editor = monaco.editor.getEditors()[0];
      return editor.getOption(monaco.editor.EditorOption.wrappingInfo).wrappingColumn;
    })).toBeGreaterThan(0);
  }
});

test('scrollbar hover respects Monaco visibility and wrap can still be toggled', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => window.wrappingTrial.config.getState().setConfig('wordWrap', false));
  // No overflow: hovering must not resurrect Monaco's invisible scrollbar.
  await expect.poll(() => horizontalVisible(page)).toBe(false);
  await page.evaluate(() => window.wrappingTrial.store.getState().replaceTabContent('/wrapping.md', { content: 'x'.repeat(4000) }));
  await expect.poll(() => horizontalVisible(page)).toBe(true);
  await page.evaluate(() => window.wrappingTrial.config.getState().setConfig('wordWrap', true));
  await expect.poll(() => horizontalVisible(page)).toBe(false);
  await page.evaluate(() => window.wrappingTrial.monaco.editor.getEditors()[0].updateOptions({ wordWrapOverride1: 'off' }));
  await expect.poll(() => horizontalVisible(page)).toBe(true);
  await page.evaluate(() => window.wrappingTrial.config.getState().setConfig('wordWrap', false));
  await expect.poll(() => horizontalVisible(page)).toBe(true);
  await page.evaluate(() => window.wrappingTrial.config.getState().setConfig('wordWrap', true));
  await expect.poll(() => horizontalVisible(page)).toBe(true);
  await page.evaluate(() => window.wrappingTrial.monaco.editor.getEditors()[0].updateOptions({ wordWrapOverride1: 'inherit' }));
  await expect.poll(() => horizontalVisible(page)).toBe(false);
});

test('historical diff wraps both panes without horizontal scrollbars', async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const { store } = window.wrappingTrial;
    store.getState().replaceTabContent('/wrapping.md', { content: 'current text '.repeat(180) });
    const { default: history } = await import('/src/store/useHistoryStore.js');
    history.getState().setDiff({ tabId: '/wrapping.md', timestamp: 1, content: 'historical text '.repeat(180) });
  });
  await expect(page.locator('.history-diff__editor .monaco-editor')).toHaveCount(2);
  await page.locator('.history-diff__editor').hover();
  await expect.poll(() => horizontalVisible(page)).toBe(false);
  await expect.poll(() => page.evaluate(() => {
    const { monaco } = window.wrappingTrial;
    return monaco.editor.getEditors().map((editor) => editor.getOption(monaco.editor.EditorOption.wrappingInfo).wrappingColumn > 0);
  })).toEqual([true, true]);
});

test('IME composition across a wrapped line does not scroll or overlap the editor line', async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 540, height: 700 });
  const line = '* [ ] Markdown 预览无法渲染 Base64 的图片以及 base64 的图片';
  await page.evaluate((text) => {
    const { store } = window.wrappingTrial;
    store.getState().setSidebarVisible(false);
    store.getState().replaceTabContent('/wrapping.md', { content: `\n\n\n\n${text}\n` });
  }, line);
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('base64');
  await page.evaluate(() => {
    const { monaco } = window.wrappingTrial;
    const editor = monaco.editor.getEditors()[0];
    editor.setPosition({ lineNumber: 5, column: editor.getModel().getLineMaxColumn(5) });
    editor.focus();
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'ying', selectionStart: 4, selectionEnd: 4 });
  const state = await page.evaluate(() => {
    const ta = document.querySelector('.monaco-editor textarea.inputarea');
    const wrappedLine = [...document.querySelectorAll('.monaco-editor .view-line')]
      .find((el) => el.textContent.includes('ying'));
    return {
      value: ta.value,
      scrollLeft: ta.scrollLeft,
      taTop: ta.getBoundingClientRect().top,
      lineTop: wrappedLine?.getBoundingClientRect().top ?? null,
    };
  });
  expect(state.value).toBe('ying');
  expect(state.scrollLeft).toBe(0);
  expect(state.lineTop).not.toBeNull();
  expect(Math.abs(state.taTop - state.lineTop)).toBeLessThan(2);
  await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
});

