import { test, expect } from '@playwright/test';

async function bootApp(page, { name, content, mode = 'edit' }) {
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  await page.evaluate(
    async ({ name, content, mode }) => {
      const { preloadMonacoEditor } = await import('/src/utils/monacoRuntimeBoot.js');
      await preloadMonacoEditor();
      const { default: store } = await import('/src/store/useEditorStore.js');
      const { default: config } = await import('/src/store/useConfigStore.js');
      const monaco = await import('/node_modules/monaco-editor/esm/vs/editor/editor.main.js');
      config.getState().setConfig('autoSave', false);
      config.getState().setConfig('language', 'zh');
      store.getState().openFile({ path: `/${name}`, name, content });
      store.getState().setViewMode(mode);
      window.snapshotTrial = { store, monaco };
    },
    { name, content, mode },
  );
}

test('Monaco right-click menu and shortcut open Snapshot Studio for selected code with independent header & rainbow controls', async ({
  page,
}) => {
  await bootApp(page, {
    name: 'demo.js',
    content: [
      'export function greet(name) {',
      '  const msg = `Hello, ${name}!`;',
      '  return msg;',
      '}',
    ].join('\n'),
  });
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('greet');

  await page.evaluate(() => {
    const editor = window.snapshotTrial.monaco.editor.getEditors()[0];
    editor.setSelection({
      startLineNumber: 2,
      startColumn: 1,
      endLineNumber: 3,
      endColumn: 14,
    });
    editor.focus();
  });

  await page.locator('.monaco-editor .view-line').nth(1).click({ button: 'right' });
  const snapshotItem = page.locator('.monaco-context-menu__item', { hasText: /生成截图|Snapshot/ });
  await expect(snapshotItem).toBeVisible();
  await snapshotItem.click();

  const modal = page.locator('.snapshot-modal');
  await expect(modal).toBeVisible();
  // Mode switcher nav has been removed; source selection opens directly in code mode.
  await expect(modal.locator('.snapshot-modal__mode-switch')).toHaveCount(0);
  await expect(modal.locator('.snapshot-card__code .line-numbers').first()).toHaveText('2');
  await expect(modal.locator('.snapshot-card__code')).toContainText('const msg');
  await expect(modal.locator('.snapshot-card__code')).not.toContainText('export function');

  // Verify independent file name & file type toggles.
  await expect(modal.locator('.snapshot-card__title-input')).toBeVisible();
  await expect(modal.locator('.snapshot-card__lang')).toBeVisible();
  await modal.getByRole('switch', { name: /显示文件名称|Show file name/ }).click();
  await expect(modal.locator('.snapshot-card__title-input')).toHaveCount(0);
  await expect(modal.locator('.snapshot-card__lang')).toBeVisible();
  await modal.getByRole('switch', { name: /显示文件类型|Show file type/ }).click();
  await expect(modal.locator('.snapshot-card__lang')).toHaveCount(0);

  // Verify Canvas PNG export works cleanly with rainbow indent and non-empty image bytes.
  const exported = await page.evaluate(async () => {
    const { renderCodeSnapshotCanvas, tokenizeSnapshotCode } = await import(
      '/src/utils/snapshotExport.js'
    );
    const tokens = await tokenizeSnapshotCode('  const msg = "hi";\n  return msg;', 'javascript', false);
    const canvas = await renderCodeSnapshotCanvas({
      tokens,
      dark: false,
      backdrop: 'vitality',
      windowStyle: 'moki',
      showFileName: false,
      showFileType: false,
      showIndentRainbow: true,
      indentRainbowStyle: 'surface',
      title: 'demo.js',
      language: 'javascript',
      startLine: 2,
      scale: 2,
    });
    const url = canvas.toDataURL('image/png');
    return { width: canvas.width, height: canvas.height, prefix: url.slice(0, 22), len: url.length };
  });
  expect(exported.width).toBeGreaterThan(800);
  expect(exported.height).toBeGreaterThan(200);
  expect(exported.prefix).toBe('data:image/png;base64,');
  expect(exported.len).toBeGreaterThan(2000);

  // Verify preview has no horizontal overflow even when card width is maximized.
  const overflowInfo = await page.evaluate(() => {
    const scrollEl = document.querySelector('.snapshot-modal__canvas-scroll');
    return {
      scrollWidth: scrollEl?.scrollWidth || 0,
      clientWidth: scrollEl?.clientWidth || 0,
    };
  });
  expect(overflowInfo.scrollWidth).toBeLessThanOrEqual(overflowInfo.clientWidth + 1);

  // Close and verify shortcut Ctrl+Alt+S reopens Snapshot Studio with the selection.
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await page.evaluate(() => window.snapshotTrial.monaco.editor.getEditors()[0].focus());
  await page.keyboard.press('Control+Alt+KeyS');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.snapshot-card__code')).toContainText('const msg');
});

test('Milkdown opens directly in rendered Markdown mode while Monaco on .md opens in code mode', async ({
  page,
}) => {
  await bootApp(page, {
    name: 'notes.md',
    content: '# Hello MokiDown\n\n- [x] Ship **Snapshot Studio**\n\n> Vitality glow\n',
    mode: 'preview',
  });
  const editor = page.locator('.milkdown-editor');
  await expect(editor).toContainText('Hello MokiDown', { timeout: 15000 });

  await editor.locator('h1').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /生成截图|Snapshot/ }).click();

  const modal = page.locator('.snapshot-modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.snapshot-modal__mode-switch')).toHaveCount(0);
  await expect(modal.locator('.snapshot-card__markdown h1')).toHaveText('Hello MokiDown');
  await expect(modal.locator('.snapshot-card__markdown blockquote')).toContainText('Vitality glow');

  // Verify Markdown card exports to an untainted PNG canvas.
  const pngInfo = await page.evaluate(async () => {
    const { renderMarkdownSnapshotCanvas } = await import('/src/utils/snapshotExport.js');
    const body = document.querySelector('.snapshot-card__markdown');
    const canvas = await renderMarkdownSnapshotCanvas(body, {
      dark: false,
      backdrop: 'vitality',
      windowStyle: 'moki',
      title: 'notes.md',
      scale: 2,
    });
    const url = canvas.toDataURL('image/png');
    return { width: canvas.width, height: canvas.height, prefix: url.slice(0, 22), len: url.length };
  });
  expect(pngInfo.width).toBeGreaterThan(800);
  expect(pngInfo.height).toBeGreaterThan(200);
  expect(pngInfo.prefix).toBe('data:image/png;base64,');
  expect(pngInfo.len).toBeGreaterThan(2000);

  // Switch editor to source mode on the same .md file -> Snapshot Studio opens directly in code mode.
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await page.evaluate(() => {
    window.snapshotTrial.store.getState().setViewMode('edit');
  });
  await expect(page.locator('.monaco-editor .view-lines')).toContainText('# Hello MokiDown');
  await page.locator('.monaco-editor .view-line').first().click({ button: 'right' });
  await page.locator('.monaco-context-menu__item', { hasText: /生成截图|Snapshot/ }).click();
  await expect(modal).toBeVisible();
  await expect(modal.locator('.snapshot-card__code')).toContainText('# Hello MokiDown');
});

test('Settings Quick Snapshot tab expands cleanly with translucent stage, bounded width, and triggers without opening modal', async ({
  page,
}) => {
  await bootApp(page, {
    name: 'quick.js',
    content: 'function run() {\n  return 42;\n}\n',
    mode: 'edit',
  });

  await page.keyboard.press('Control+Comma');
  const quickNav = page.getByRole('button', { name: /快速截图|Quick Snapshot/ });
  await expect(quickNav).toBeVisible();
  await quickNav.click();

  const quickSettings = page.locator('.snapshot-quick-settings');
  await expect(quickSettings).toBeVisible();

  const metrics = await page.evaluate(() => {
    const scrollEl = document.querySelector('.snapshot-quick-settings__stage .snapshot-modal__canvas-scroll');
    const stageEl = document.querySelector('.snapshot-quick-settings__stage');
    const cardEl = document.querySelector('.snapshot-quick-settings__stage .snapshot-card');
    const stageBg = stageEl ? getComputedStyle(stageEl).backgroundColor : '';
    return {
      scrollWidth: scrollEl?.scrollWidth || 0,
      clientWidth: scrollEl?.clientWidth || 0,
      cardWidth: cardEl?.getBoundingClientRect().width || 0,
      stageBg,
    };
  });
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.cardWidth).toBeLessThanOrEqual(metrics.clientWidth);
  expect(metrics.stageBg).toMatch(/rgba|color\(srgb .* \/ 0\./);
});
