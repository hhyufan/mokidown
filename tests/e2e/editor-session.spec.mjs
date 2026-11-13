import { test, expect } from '@playwright/test';

async function prepare(page, mode = 'edit') {
  await page.addInitScript(() => {
    let next = 0;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: () => ++next,
      unregisterCallback() {},
      invoke: async (command, args = {}) => {
        if (command === 'read_file_content') {
          const content = localStorage.getItem(`session-file:${args.path}`);
          return { success: content != null, content };
        }
        if (command.startsWith('plugin:event|')) return ++next;
        if (command.startsWith('is_')) return false;
        if (['reader_bootstrap', 'read_recovery_snapshot'].includes(command)) return null;
        if (['get_cli_args', 'list_language_plugins', 'history_list', 'read_runtime_logs'].includes(command)) return [];
        return true;
      },
    };
  });
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 25000 });
  await page.evaluate(async (mode) => {
    const { preloadMonacoEditor } = await import('/src/utils/monacoRuntimeBoot.js');
    await preloadMonacoEditor();
    const { default: store } = await import('/src/store/useEditorStore.js');
    const { default: config } = await import('/src/store/useConfigStore.js');
    config.getState().setConfig('autoSave', false);
    config.getState().setConfig('previewZoomSync', false);
    const text = '# Document A\n\n' + Array.from({ length: 120 }, (_, i) => `Paragraph ${i} with some text.\n\n`).join('');
    localStorage.setItem('session-file:/a.md', text);
    localStorage.setItem('session-file:/b.md', '# Document B');
    store.getState().openFile({ path: '/a.md', name: 'a.md', content: text });
    store.getState().openFile({ path: '/b.md', name: 'b.md', content: '# Document B' });
    store.getState().setActiveTab('/a.md');
    store.getState().setViewMode(mode);
    store.getState().setSidebarView('outline');
    store.getState().setToolbarVisible(true);
  }, mode);
}

test('reload restores ordered tabs, active document, layout and Monaco cursor/scroll', async ({ page }) => {
  test.setTimeout(60000);
  await prepare(page, 'split');
  await expect(page.locator('.md-preview h1')).toHaveText('Document A');
  const before = await page.evaluate(async () => {
    const monaco = await import('/node_modules/monaco-editor/esm/vs/editor/editor.main.js');
    const editor = monaco.editor.getEditors()[0];
    editor.setPosition({ lineNumber: 40, column: 5 });
    const preview = document.querySelector('.md-preview');
    preview.scrollTop = 600;
    // The panes now persist one synchronized position.
    for (let frame = 0; frame < 3; frame++) await new Promise(requestAnimationFrame);
    const { flushEditorSession } = await import('/src/services/editorSession.js');
    flushEditorSession();
    return { cursor: editor.getPosition(), scroll: editor.getScrollTop(), preview: preview.scrollTop };
  });
  await page.reload();
  await expect(page.locator('.md-preview h1')).toHaveText('Document A');
  await expect.poll(() => page.evaluate(async () => {
    const { default: store } = await import('/src/store/useEditorStore.js');
    const state = store.getState();
    return { tabs: state.tabRenderList.map((tab) => tab.id), active: state.activeTabId,
      mode: state.viewMode, sidebar: state.sidebarView, toolbar: state.toolbarVisible };
  })).toEqual({ tabs: ['/a.md', '/b.md'], active: '/a.md', mode: 'split', sidebar: 'outline', toolbar: true });
  await expect.poll(() => page.evaluate(async () => {
    const monaco = await import('/node_modules/monaco-editor/esm/vs/editor/editor.main.js');
    const editor = monaco.editor.getEditors()[0];
    return { cursor: editor.getPosition(), scroll: editor.getScrollTop(), preview: document.querySelector('.md-preview').scrollTop };
  })).toMatchObject({ cursor: before.cursor, scroll: before.scroll });
  await expect.poll(async () => Math.abs(before.preview - await page.locator('.md-preview').evaluate((element) => element.scrollTop)))
    .toBeLessThan(2);
  // Closing a tab is persisted immediately; it must never reappear on reload.
  await page.evaluate(async () => {
    const { default: store } = await import('/src/store/useEditorStore.js');
    store.getState().closeTab('/b.md');
  });
  await page.reload();
  await expect(page.locator('.md-preview h1')).toHaveText('Document A');
  expect(await page.evaluate(async () => {
    const { default: store } = await import('/src/store/useEditorStore.js');
    return store.getState().tabRenderList.map((tab) => tab.id);
  })).toEqual(['/a.md']);
});

test('reload restores Milkdown selection and viewport', async ({ page }) => {
  test.setTimeout(60000);
  await prepare(page, 'preview');
  await expect(page.locator('.milkdown-editor > p').first()).toBeVisible();
  await page.locator('.milkdown-editor > p').first().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  const before = await page.evaluate(async () => {
    const selection = window.getSelection();
    const scroll = document.querySelector('.md-preview--milkdown');
    scroll.scrollTop = 600;
    const { flushEditorSession } = await import('/src/services/editorSession.js');
    flushEditorSession();
    return { text: selection.toString(), anchor: selection.anchorOffset, head: selection.focusOffset, top: scroll.scrollTop };
  });
  await page.reload();
  await expect(page.locator('.md-preview--milkdown')).not.toHaveClass(/md-preview--stale/);
  await page.locator('.milkdown-editor').evaluate((element) => element.focus({ preventScroll: true }));
  await expect.poll(() => page.evaluate(() => {
    const selection = window.getSelection();
    return { text: selection.toString(), anchor: selection.anchorOffset, head: selection.focusOffset,
      top: document.querySelector('.md-preview--milkdown').scrollTop };
  })).toEqual(before);
});
