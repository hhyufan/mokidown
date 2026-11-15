import { expect, test } from '@playwright/test';

test('the new-tab menu closes tabs and asks before discarding a dirty document', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  await page.evaluate(async () => {
    const { default: store } = await import('/src/store/useEditorStore.js');
    store.getState().createUntitledTab({ name: 'draft.txt', content: 'Draft' });
    store.getState().openFile({ path: '/clean.txt', name: 'clean.txt', content: 'Clean' });
  });
  const sheet = page.locator('.tabbar__new-tab');
  const tabs = page.locator('.tabbar [data-tab-id]');
  await sheet.click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Close All Tabs|关闭所有标签页/ }).click();
  const prompt = page.getByRole('dialog');
  await expect(prompt.getByText('draft.txt')).toBeVisible();
  await expect(tabs).toHaveCount(2);
  await prompt.getByRole('button', { name: /Don.t save|不保存/i }).click();
  await expect(tabs).toHaveCount(0);
});

test('browser file drop draws an editor outline and opens the text in a new tab', async ({ page }) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const editor = page.locator('.editor-content');
  await expect(editor.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['From drop'], 'example.txt', { type: 'text/plain' }));
    return transfer;
  });
  const bounds = await editor.boundingBox();
  const position = { clientX: bounds.x + 32, clientY: bounds.y + 40, dataTransfer };
  await editor.dispatchEvent('dragover', position);
  await expect(page.locator('.drag-overlay--editor')).toBeVisible();
  await editor.dispatchEvent('drop', position);
  await expect(page.locator('.drag-overlay')).toHaveCount(0);
  await expect(page.locator('.tabbar')).toContainText('example.txt');
  await expect.poll(() => page.evaluate(async () => {
    const { default: store } = await import('/src/store/useEditorStore.js');
    return store.getState().getTabContent(store.getState().activeTabId);
  })).toBe('From drop');
  expect(errors.filter((message) => /isDragOver|FileDropConflict/.test(message))).toEqual([]);
});

test('Windows starts tracking an explorer row inside the app and routes local drops to the destination folder', async ({ page }) => {
  test.setTimeout(60000);
  const source = 'C:/project/example.txt';
  const directory = 'C:/project/folder';
  await page.addInitScript(() => {
    let next = 0;
    const callbacks = new Map();
    const listeners = new Map();
    window.fileDragCalls = [];
    window.sendNativeDragEvent = (event, payload) => listeners.get(event)?.({ event, payload });
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: (callback) => { callbacks.set(++next, callback); return next; },
      unregisterCallback: (id) => callbacks.delete(id),
      invoke: async (command, args = {}) => {
        if (command === 'plugin:event|listen') {
          listeners.set(args.event, callbacks.get(args.handler));
          return ++next;
        }
        if (command === 'transfer_dropped_entry') {
          window.fileDragCalls.push({ command, ...args });
          return args.name ? { status: 'unchanged' } : { status: 'conflict', path: args.directory + '/example.txt' };
        }
        if (command === 'begin_reader_tab_detach_watch') {
          window.fileDragCalls.push({ command, ...args });
          return false;
        }
        if (command.startsWith('is_')) return false;
        if (['reader_bootstrap', 'read_recovery_snapshot'].includes(command)) return null;
        if (['get_cli_args', 'list_language_plugins', 'history_list', 'read_runtime_logs'].includes(command)) return [];
        return true;
      },
    };
  });
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  await page.evaluate(({ source, directory }) => {
    const fixture = document.createElement('section');
    fixture.className = 'file-tree';
    fixture.style.cssText = 'position:fixed;z-index:100;left:70px;top:160px;width:150px';
    fixture.innerHTML = '<div id="drag-test-source" style="height:32px">example.txt</div><div id="drag-test-target" style="height:32px">folder</div>';
    fixture.firstChild.dataset.readerPath = source;
    fixture.lastChild.dataset.dropDirectory = directory;
    document.body.append(fixture);
  }, { source, directory });
  const from = await page.locator('#drag-test-source').boundingBox();
  const to = await page.locator('#drag-test-target').boundingBox();
  await page.mouse.move(from.x + 25, from.y + 12);
  await page.mouse.down();
  await page.mouse.move(to.x + 25, to.y + 12, { steps: 6 });
  await expect.poll(() => page.evaluate(() => window.fileDragCalls[0])).toMatchObject({
    command: 'begin_reader_tab_detach_watch',
    document: { path: source, keepSource: true },
    shellDrop: true,
    preview: { token: expect.any(String), name: 'example.txt', markup: expect.stringContaining('example.txt') },
  });
  await expect(page.locator('.drag-overlay--explorer')).toBeVisible();
  await page.mouse.up();
  const conflict = page.getByRole('dialog');
  await expect(conflict.getByRole('textbox')).toHaveValue('example (2).txt');
  await conflict.getByRole('button', { name: /Keep Both|保留两份/ }).click();
  await expect.poll(() => page.evaluate(() => window.fileDragCalls.slice(1))).toEqual([
    { command: 'transfer_dropped_entry', source, directory, name: null, effect: null },
    { command: 'transfer_dropped_entry', source, directory, name: 'example (2).txt', effect: null },
  ]);
  await expect(page.locator('.drag-overlay')).toHaveCount(0);

  await page.evaluate(({ x, y }) => {
    const position = { x: x * devicePixelRatio, y: y * devicePixelRatio };
    window.sendNativeDragEvent('tauri://drag-enter', { position });
  }, { x: to.x + 25, y: to.y + 12 });
  await expect(page.locator('.drag-overlay--explorer')).toBeVisible();
  await page.evaluate(({ x, y }) => {
    const position = { x: x * devicePixelRatio, y: y * devicePixelRatio };
    window.sendNativeDragEvent('tauri://drag-drop', { position, paths: ['D:/example.txt'] });
  }, { x: to.x + 25, y: to.y + 12 });
  await expect(conflict.getByRole('textbox')).toHaveValue('example (2).txt');
  await conflict.getByRole('button', { name: /Skip|跳过/ }).click();
  await expect.poll(() => page.evaluate(() => window.fileDragCalls.at(-1))).toMatchObject({
    command: 'transfer_dropped_entry', source: 'D:/example.txt', directory,
  });
});
