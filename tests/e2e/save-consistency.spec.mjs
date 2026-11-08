import { test, expect } from '@playwright/test';

function installDisk() {
  const key = 'trial-save-disk';
  let callbackId = 0;
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback: () => ++callbackId, unregisterCallback() {},
    invoke: async (command, args = {}) => {
      if (command === 'read_file_content') return { success: true, content: localStorage.getItem(key) || '', encoding: 'UTF-8' };
      if (command === 'save_file') {
        localStorage.setItem(key, args.content);
        return { success: true, file_path: args.filePath };
      }
      if (command === 'read_recovery_snapshot') return JSON.parse(localStorage.getItem('trial-recovery') || 'null');
      if (command === 'write_recovery_snapshot') { localStorage.setItem('trial-recovery', JSON.stringify(args.snapshot)); return; }
      if (command === 'clear_recovery_snapshot') { localStorage.removeItem('trial-recovery'); return; }
      if (['history_list', 'list_language_plugins', 'get_cli_args', 'get_directory_contents'].includes(command)) return [];
      if (command === 'get_refresh_credential') return null;
      if (command.startsWith('plugin:event|')) return 1;
      if (command.includes('is_')) return false;
      return true;
    },
  };
}

for (const mode of ['edit', 'preview']) {
  test(`${mode} saves the latest typed text, clears the dot, and reopens without recovery conflict`, async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/');
    await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
    await page.evaluate(installDisk);
    await page.evaluate(async (viewMode) => {
      const { default: store } = await import('/src/store/useEditorStore.js');
      const { default: config } = await import('/src/store/useConfigStore.js');
      const { default: i18n } = await import('/src/i18n/index.js');
      await i18n.changeLanguage('en');
      config.getState().setConfig('autoSave', false);
      localStorage.setItem('trial-save-disk', 'base\n');
      store.getState().openFile({ path: '/consistency.md', name: 'consistency.md', content: 'base\n' });
      store.getState().setViewMode(viewMode);
    }, mode);
    if (mode === 'edit') {
      const input = page.locator('.monaco-editor textarea').first();
      await expect(input).toBeVisible(); await input.focus();
      await page.keyboard.press('Control+End');
    } else {
      await page.locator('.milkdown-editor > p').click();
      await page.keyboard.press('End');
    }
    await page.keyboard.insertText('最后输入的中文');
    // Save immediately, before Milkdown's 200 ms publication timer can run.
    await page.keyboard.press('Control+s');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('trial-save-disk'))).toContain('最后输入的中文');
    await expect(page.locator('.tabbar__tab-dot')).toHaveCount(0);
    await page.waitForTimeout(650);
    await expect(page.locator('.tabbar__tab-dot')).toHaveCount(0);
    await page.evaluate(async () => {
      const { default: store } = await import('/src/store/useEditorStore.js');
      const { getBuffer } = await import('/src/utils/editorBuffer.js');
      const tab = store.getState().tabs[0];
      if (tab.modified || tab.content !== getBuffer(tab.id) || tab.content !== localStorage.getItem('trial-save-disk')) throw new Error('Saved state disagrees with disk');
      const { flushRecoverySnapshot } = await import('/src/services/recoveryService.js');
      const { flushEditorSession } = await import('/src/services/editorSession.js');
      await flushRecoverySnapshot(); flushEditorSession();
    });
    expect(await page.evaluate(() => localStorage.getItem('trial-recovery'))).toBeNull();
    await page.addInitScript(installDisk);
    await page.reload();
    await expect(page.locator(mode === 'edit' ? '.monaco-editor .view-lines' : '.milkdown-editor')).toContainText('最后输入的中文');
    await expect(page.locator('.tabbar__tab-dot')).toHaveCount(0);
    await expect(page.getByText('恢复未保存内容', { exact: true })).toHaveCount(0);
    await expect(page.getByText('磁盘文件也已变化', { exact: true })).toHaveCount(0);
  });
}

for (const first of ['edit', 'preview']) {
  test(`undo and redo follow the document across modes starting in ${first}`, async ({ page }) => {
    await page.goto('/');
    test.setTimeout(60000);
    await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
    await page.evaluate(installDisk);
    await page.evaluate(async () => {
      const { default: store } = await import('/src/store/useEditorStore.js');
      const { default: config } = await import('/src/store/useConfigStore.js');
      config.getState().setConfig('autoSave', false);
      localStorage.setItem('trial-save-disk', 'base');
      store.getState().openFile({ path: '/history.md', name: 'history.md', content: 'base' });
    });
    const focusMode = async (mode) => {
      await page.evaluate(async (mode) => {
        (await import('/src/store/useEditorStore.js')).default.getState().setViewMode(mode);
      }, mode);
      if (mode === 'edit') {
        const input = page.locator('.monaco-editor textarea').first();
        await expect(input).toBeVisible();
        await input.focus();
        await page.keyboard.press('Control+Home');
        await page.keyboard.press('End');
        return page.locator('.monaco-editor .view-lines');
      }
      const prose = page.locator('.milkdown-editor > p');
      await prose.click();
      await page.keyboard.press('End');
      return prose;
    };
    const second = first === 'edit' ? 'preview' : 'edit';
    await focusMode(first);
    await page.keyboard.type(' first');
    let body = await focusMode(second);
    await expect(body).toContainText('base first');
    await page.keyboard.type(' second');
    await expect(body).toContainText('base first second');
    await page.keyboard.press('Control+z');
    await expect(body).toContainText('base first');
    await expect(body).not.toContainText('second');
    await page.keyboard.press('Control+z');
    await expect(body).toContainText('base');
    await expect(body).not.toContainText('first');
    body = await focusMode(first);
    await page.keyboard.press('Control+y');
    await expect(body).toContainText('base first');
    await page.keyboard.press('Control+Shift+z');
    await expect(body).toContainText('base first second');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('End');
    await page.keyboard.type(' branch');
    body = await focusMode(second);
    await page.keyboard.press('Control+y');
    await expect(body).toContainText('base first branch');
    await expect(body).not.toContainText('second');
  });
}

test('focus catches a missed disk event and using disk content refreshes the live Markdown document', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  await page.evaluate(installDisk);
  await page.evaluate(async () => {
    const { default: store } = await import('/src/store/useEditorStore.js');
    const { default: config } = await import('/src/store/useConfigStore.js');
    const { default: i18n } = await import('/src/i18n/index.js');
    await i18n.changeLanguage('en');
    config.getState().setConfig('autoSave', false);
    localStorage.setItem('trial-save-disk', 'base\n');
    store.getState().openFile({ path: '/conflict.md', name: 'conflict.md', content: 'base\n' });
    store.getState().setViewMode('preview');
  });
  const prose = page.locator('.milkdown-editor > p');
  await expect(prose).toHaveText('base');
  const changeOnDisk = (text, focus = true) => page.evaluate(({ text, focus }) => {
    localStorage.setItem('trial-save-disk', `${text}\n`);
    if (focus) window.dispatchEvent(new Event('focus'));
  }, { text, focus });
  await changeOnDisk('quiet reload');
  await expect(prose).toHaveText('quiet reload');
  await expect(page.locator('.external-file-notice')).toHaveCount(0);

  await prose.click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(' with local edits');
  await changeOnDisk('reviewed version');
  await page.getByRole('button', { name: 'Review changes' }).click();
  const dialog = page.getByRole('dialog', { name: 'File changed outside the editor' });
  await expect(dialog.locator('.editor.modified .view-lines')).toContainText('reviewed version');
  await page.evaluate(() => document.body.classList.add('moki-has-background'));
  for (const selector of ['.conflict-dialog__pane-labels', '.monaco-editor-background', '.ant-modal-footer', '.ant-btn-default']) {
    const alpha = await dialog.locator(selector).first().evaluate((element) => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      context.fillStyle = getComputedStyle(element).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[3];
    });
    expect(alpha).toBeLessThan(255);
  }
  await changeOnDisk('latest disk version', false);
  await dialog.getByRole('button', { name: 'Use disk content' }).click();
  await expect(prose).toHaveText('latest disk version');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.tabbar__tab-dot')).toHaveCount(0);
});
