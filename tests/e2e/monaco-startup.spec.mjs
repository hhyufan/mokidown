import { test, expect } from '@playwright/test';

test('Monaco keeps the light caret during theme changes and IME composition', async ({ page }) => {
  test.setTimeout(45000);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/tests/background-harness.html');
  await page.waitForFunction(() => window.trial?.editor);
  await page.addStyleTag({
    content: `
    .monaco-editor .cursors-layer[class] > .cursor { background-color: white; border-color: white; }
    .monaco-editor .inputarea.ime-input { caret-color: white; }
  `,
  });
  const editor = page.locator('#editor .monaco-editor');
  const input = editor.locator('textarea.inputarea');
  const cursor = editor.locator('.cursors-layer > .cursor').first();
  for (const [theme, color] of [
    ['light', 'rgb(82, 111, 255)'],
    ['dark', 'rgb(82, 139, 255)'],
    ['light', 'rgb(82, 111, 255)'],
  ]) {
    await page.evaluate((theme) => window.trial.apply({ theme, background: false }), theme);
    await input.focus();
    await expect(cursor).toHaveCSS('background-color', color);
    await input.evaluate((element) =>
      element.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true })),
    );
    await expect(input).toHaveClass(/ime-input/);
    await expect(input).toHaveCSS('caret-color', color);
    await input.evaluate((element) =>
      element.dispatchEvent(new CompositionEvent('compositionend', { data: '', bubbles: true })),
    );
    await expect(input).not.toHaveClass(/ime-input/);
    await input.blur();
  }
});

test('the application prepares Monaco on the welcome screen and opens its first document without a loading spinner', async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  // A cold dev server may still be transforming the application dependency graph.
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  await page.waitForFunction(async () => {
    const boot = await import('/src/utils/monacoRuntimeBoot.js');
    return Boolean(boot.getLoadedMonacoEditor());
  });
  await page.evaluate(async () => {
    const { default: store } = await import('/src/store/useEditorStore.js');
    const { default: config } = await import('/src/store/useConfigStore.js');
    // This document exists only in the test buffer, not on the native disk.
    config.getState().setConfig('autoSave', false);
    const monaco = await import('/node_modules/monaco-editor/esm/vs/editor/editor.main.js');
    window.startupModels = [];
    window.startupModelListener = monaco.editor.onDidCreateModel((model) =>
      window.startupModels.push(model.uri.toString()),
    );
    const workspace = document.querySelector('.editor-content');
    window.startupSpinners = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) {
          if (
            node instanceof Element &&
            (node.matches('.ant-spin') || node.querySelector('.ant-spin'))
          )
            window.startupSpinners += 1;
        }
    });
    observer.observe(workspace, { childList: true, subtree: true });
    window.startupObserver = observer;
    store
      .getState()
      .openFile({ path: '/startup.md', name: 'startup.md', content: '# Ready\n\n**bold**\n' });
  });
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('Ready');
  await expect(page.locator('.monaco-editor-container[aria-busy="true"]')).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      window.startupObserver.disconnect();
      return window.startupSpinners;
    }),
  ).toBe(0);
  // The dev entry deliberately uses StrictMode's setup/cleanup/setup cycle.
  // Both mounts must create the real file, never a throwaway blank model.
  expect(
    await page.evaluate(() => {
      window.startupModelListener.dispose();
      return window.startupModels;
    }),
  ).toEqual(['file:///startup.md', 'file:///startup.md']);
  await page.locator('.monaco-editor textarea').focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('editable');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { default: store } = await import('/src/store/useEditorStore.js');
        return store.getState().getActiveTab()?.content;
      }),
    )
    .toContain('editable');
  expect(errors).toEqual([]);
});
