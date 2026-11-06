import { expect, test } from '@playwright/test';

test('Monaco Markdown shares paired deletion, the code fence shortcut and the opt-out', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await page.evaluate(async () => {
    const { preloadMonacoEditor } = await import('/src/utils/monacoRuntimeBoot.js');
    await preloadMonacoEditor();
    const { default: store } = await import('/src/store/useEditorStore.js');
    const { default: config } = await import('/src/store/useConfigStore.js');
    const monaco = await import('/node_modules/monaco-editor/esm/vs/editor/editor.main.js');
    config.getState().setConfig('autoSave', false);
    store.getState().openFile({ path: '/pairs.md', name: 'pairs.md', content: '**213**' });
    window.markdownPairsTrial = { config, editor: () => monaco.editor.getEditors()[0] };
  });
  const value = () => page.evaluate(() => window.markdownPairsTrial.editor().getValue().replace(/\r\n/g, '\n'));
  await expect.poll(value).toBe('**213**');
  await page.evaluate(() => {
    const editor = window.markdownPairsTrial.editor();
    editor.setPosition({ lineNumber: 1, column: 3 }); editor.focus();
  });
  await page.keyboard.press('Backspace');
  await expect.poll(value).toBe('*213*');
  await page.keyboard.press('Control+z');
  await expect.poll(value).toBe('**213**');
  await page.evaluate(() => {
    const editor = window.markdownPairsTrial.editor();
    editor.setValue(''); editor.setPosition({ lineNumber: 1, column: 1 });
  });
  await page.keyboard.type('``');
  await expect.poll(value).toBe('``');
  expect(await page.evaluate(() => window.markdownPairsTrial.editor().getPosition())).toMatchObject({ lineNumber: 1, column: 2 });
  await page.keyboard.type('`');
  await expect.poll(value).toBe('```');
  await expect(page.locator('.moki-code-language-dropdown')).toBeVisible();
  expect(await page.evaluate(() => window.markdownPairsTrial.editor().getPosition())).toMatchObject({ lineNumber: 1, column: 4 });
  await page.keyboard.press('Enter');
  await expect.poll(value).toBe('```\n\n```');
  expect(await page.evaluate(() => window.markdownPairsTrial.editor().getPosition())).toMatchObject({ lineNumber: 2, column: 1 });
  await page.keyboard.press('Control+z');
  await expect.poll(value).toBe('```');
  await page.keyboard.type('java');
  await expect.poll(value).toBe('```java');
  await page.keyboard.type('script');
  await expect.poll(value).toBe('```javascript\n\n```');
  await page.evaluate(() => {
    const editor = window.markdownPairsTrial.editor();
    editor.setValue(''); editor.setPosition({ lineNumber: 1, column: 1 });
  });
  await page.keyboard.type('**');
  await expect.poll(value).toBe('**');
  expect(await page.evaluate(() => window.markdownPairsTrial.editor().getPosition())).toMatchObject({ lineNumber: 1, column: 2 });
  await page.keyboard.type('*');
  await expect.poll(value).toBe('****');
  expect(await page.evaluate(() => window.markdownPairsTrial.editor().getPosition())).toMatchObject({ lineNumber: 1, column: 3 });
  await page.keyboard.type('dasdas** plain');
  await expect.poll(value).toBe('**dasdas** plain');
  await page.evaluate(() => {
    window.markdownPairsTrial.config.getState().setConfig('markdownSmartPairs', ['(']);
    const editor = window.markdownPairsTrial.editor();
    editor.setValue(''); editor.setPosition({ lineNumber: 1, column: 1 });
  });
  await page.keyboard.type('``` ([');
  await expect.poll(value).toBe('``` ([)');
  await page.evaluate(() => {
    window.markdownPairsTrial.config.getState().setConfig('markdownSmartPairsEnabled', false);
    const editor = window.markdownPairsTrial.editor();
    editor.setValue(''); editor.setPosition({ lineNumber: 1, column: 1 });
  });
  await page.keyboard.type('(');
  await expect.poll(value).toBe('(');
});
