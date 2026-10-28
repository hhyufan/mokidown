import { expect, test } from '@playwright/test';

test('new tooltip and plugin fallback copy follows live language changes', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible();
  await page.evaluate(async () => {
    const { default: editor } = await import('/src/store/useEditorStore.js');
    const { default: contributions } = await import('/src/store/usePluginContributions.js');
    editor.getState().openFile({ path: 'C:/notes/locale.md', name: 'locale.md', content: '# Locale' });
    editor.getState().setViewMode('preview');
    editor.getState().setSidebarVisible(true);
    contributions.setState({ versionSources: [{ pluginId: 'sample', path: 'C:/notes/locale.md', title: 'Example versions', items: [] }] });
  });
  await page.getByRole('button', { name: 'Example versions', exact: true }).click();
  for (const [locale, history, versions, refresh, sidebar, dismiss] of [
    ['en', 'No history yet', 'No versions yet', 'Refresh', 'Toggle sidebar', 'Dismiss notification'],
    ['zh', '暂无历史记录', '暂无版本', '刷新', '切换侧栏', '关闭通知'],
  ]) {
    await page.evaluate(async (language) => {
      const { default: i18n } = await import('/src/i18n/index.js');
      const { default: config } = await import('/src/store/useConfigStore.js');
      config.getState().setConfig('language', language);
      await i18n.changeLanguage(language);
    }, locale);
    await expect(page.locator('.sidebar .timeline__placeholder')).toHaveText(history);
    const reload = page.getByRole('region', { name: 'Example versions' }).getByRole('button', { name: refresh, exact: true });
    await reload.hover();
    await expect(page.getByRole('tooltip')).toHaveText(refresh);
    const toggle = page.locator('.footer__toggle-sidebar');
    await expect(toggle).toHaveAccessibleName(sidebar);
    await toggle.hover();
    await expect(page.getByRole('tooltip')).toHaveText(sidebar);
    await page.mouse.move(1200, 700);
    await page.evaluate(async () => {
      const { default: versions } = await import('/src/store/useVersionListStore.js');
      versions.getState().show({ pluginId: 'sample', title: 'Versions', items: [] });
    });
    await expect(page.getByRole('dialog')).toContainText(versions);
    await page.evaluate(async () => {
      const { default: versions } = await import('/src/store/useVersionListStore.js');
      versions.getState().close();
      const { notifyWebDemo } = await import('/src/utils/webDemo.js');
      notifyWebDemo();
    });
    await expect(page.getByRole('button', { name: dismiss, exact: true })).toBeVisible();
    await expect(page.locator('.notif__message')).not.toContainText('webDemo.');
    await page.getByRole('button', { name: dismiss, exact: true }).click();
  }
});
