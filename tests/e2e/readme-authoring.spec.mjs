import { expect, test } from '@playwright/test';
import { authorHeroNote } from '../../scripts/hero-author-note.mjs';

test('README demo authors a new note through WYSIWYG task, code and table input', async ({ page }) => {
  await page.goto('/');
  test.setTimeout(90000);
  await expect(page.locator('.moki-action--primary')).toBeVisible({ timeout: 30000 });
  await page.evaluate(async () => {
    (await import('/src/store/useConfigStore.js')).default.getState().setConfig('autoSave', false);
    (await import('/src/store/useEditorStore.js')).default.setState({ viewMode: 'preview' });
  });
  await authorHeroNote(page, {
    click: (locator, options) => locator.click(options),
    doubleClick: locator => locator.dblclick(),
    typeText: text => page.keyboard.insertText(text),
    hold: () => Promise.resolve(), chapter: () => Promise.resolve(), snapshot: () => Promise.resolve(),
  });
  const source = await page.evaluate(async () => {
    const state = (await import('/src/store/useEditorStore.js')).default.getState();
    const { flushEditorBuffer, getBuffer } = await import('/src/utils/editorBuffer.js');
    flushEditorBuffer(state.activeTabId);
    return getBuffer(state.activeTabId);
  });
  expect(source).toMatch(/^# 灵感笔记/m);
  expect(source).toContain('**灵感**');
  expect(source).toMatch(/^[*-] \[x\] 记录灵感/m);
  expect(source).toMatch(/^[*-] \[ \] 验证想法/m);
  expect(source).toMatch(/```javascript\nconst ideas[\s\S]*?console\.log\(ideas\.join[\s\S]*?```/);
  expect(source).toMatch(/\| 记录\s*\| 写下灵感\s*\|/);
  await expect(page.locator('.tabbar__tab-name')).toHaveText('灵感笔记.md');
});
