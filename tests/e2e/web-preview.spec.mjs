import { expect, test } from '@playwright/test';
import path from 'node:path';

const bridge = path.resolve('src/utils/previewFrameBridge.js');
const content = `<style>
html,body{background:#fff;color:rgb(25,35,45)}
.card{background:rgb(245,240,235)}input,button,select{background:#eee;color:#123}
button:hover{background:rgb(100,150,200)}
</style><main class="card"><h1>Cross-origin preview</h1><input value="visible text"><button>Add</button><select><option>Option</option></select><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"></main>`;

test('cross-origin pages and dynamic controls get translucent surfaces without fading text', async ({ page }) => {
  // Mirrors AddScriptToExecuteOnDocumentCreated: Playwright installs this in
  // child frames too, including the genuinely cross-origin fixture below.
  await page.addInitScript({ path: bridge });
  await page.route('https://preview.example/**', (route) => route.fulfill({ contentType: 'text/html', body: content }));
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 40000 });
  await page.evaluate(async () => {
    const config = (await import('/src/store/useConfigStore.js')).default;
    config.setState({ backgroundEnabled: true, backgroundImage: 'data:image/svg+xml,%3Csvg/%3E' });
    const store = (await import('/src/store/useEditorStore.js')).default;
    store.getState().openWebTab('https://preview.example/');
  });
  const preview = page.frameLocator('.web-page__frame');
  await expect(preview.locator('body')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(preview.locator('input')).toHaveCSS('background-color', 'color(srgb 0.933333 0.933333 0.933333 / 0.38)');
  await expect(preview.locator('input')).toHaveCSS('color', 'rgb(17, 34, 51)');
  await expect(preview.locator('img')).toHaveCSS('opacity', '1');
  await preview.locator('main').evaluate((main) => {
    const input = document.createElement('input'); input.id = 'dynamic'; main.append(input);
  });
  await expect(preview.locator('#dynamic')).toHaveCSS('background-color', 'color(srgb 0.933333 0.933333 0.933333 / 0.38)');
  await preview.getByRole('button', { name: 'Add' }).hover();
  await expect(preview.getByRole('button')).toHaveCSS('background-color', 'color(srgb 0.392157 0.588235 0.784314 / 0.38)');
  await page.evaluate(async () => (await import('/src/store/useConfigStore.js')).default.setState({ backgroundEnabled: false }));
  await expect(preview.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(preview.locator('input').first()).toHaveCSS('background-color', 'rgb(238, 238, 238)');
});

test('opening links reuses the second pane of an existing HTML split', async ({ page }) => {
  await page.route('https://preview.example/**', (route) => route.fulfill({ contentType: 'text/html', body: content }));
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 40000 });
  await page.evaluate(async () => {
    const store = (await import('/src/store/useEditorStore.js')).default;
    store.getState().openFile({ path: '/site/index.html', name: 'index.html', content: '<h1>Local preview</h1>' });
    store.getState().setViewMode('split');
  });
  await expect(page.locator('.html-preview__frame')).toBeVisible();
  await page.evaluate(async () => (await import('/src/store/useEditorStore.js')).default.getState().openWebSplit('https://preview.example/first'));
  await expect(page.locator('.html-preview__frame')).toBeHidden();
  await expect(page.locator('.editor-content__split-divider:visible')).toHaveCount(1);
  const source = await page.locator('.editor-content__editor').boundingBox();
  const target = await page.locator('.web-page').boundingBox();
  expect(target.x).toBeGreaterThan(source.x + source.width - 1);
  expect(Math.abs(target.y - source.y)).toBeLessThan(2);
  await page.evaluate(async () => (await import('/src/store/useEditorStore.js')).default.getState().openWebSplit('https://preview.example/second'));
  await expect(page.locator('.web-page__frame')).toHaveCount(1);
  await expect(page.locator('.web-page__frame')).toHaveAttribute('src', 'https://preview.example/second');
  await page.evaluate(async () => (await import('/src/store/useEditorStore.js')).default.getState().closeWebSplit());
  await expect(page.locator('.web-page__frame')).toHaveCount(0);
  await expect(page.locator('.html-preview__frame')).toBeVisible();
});

test('terminal links keep the context menu and support all left-click modifiers', async ({ page }) => {
  await page.goto('/tests/terminal-harness.html');
  const terminal = page.locator('#terminal-panel');
  await expect(terminal.getByRole('status')).toHaveText('Local terminal');
  await page.evaluate(() => window.terminalTrial.emit('\r\nhttp://localhost:5173/test\r\n'));
  const row = terminal.locator('.xterm-rows > div').filter({ hasText: 'http://localhost:5173/test' });
  await expect(row).toBeVisible();
  const rect = await row.boundingBox();
  // 链接占据该行大部分区域，取行中点悬停即可命中。
  const point = [rect.x + rect.width / 2, rect.y + rect.height / 2];
  await page.mouse.move(...point);
  await page.mouse.click(...point, { button: 'right' });
  await expect(page.getByRole('menuitem')).toHaveCount(5);
  await page.keyboard.press('Escape');
  for (const [keys, active, split] of [[['Control'], false, false], [['Control', 'Shift'], true, false], [['Control', 'Alt'], true, true]]) {
    await page.mouse.move(...point);
    for (const key of keys) await page.keyboard.down(key);
    await page.mouse.click(...point);
    for (const key of keys.toReversed()) await page.keyboard.up(key);
    await expect.poll(() => page.evaluate(async () => {
      const state = (await import('/src/store/useEditorStore.js')).default.getState();
      return { active: state.activeTabId.startsWith('web:'), split: Boolean(state.webSplitUrl) };
    })).toEqual({ active, split });
  }
  expect(await page.evaluate(() => window.terminalTrial.commands.some(({ command }) => command === 'open_external'))).toBe(false);
});
