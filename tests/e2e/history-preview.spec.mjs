import { expect, test } from '@playwright/test';

test('rendered history aligns separate revert arrows with list items in one Markdown block', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  await page.evaluate(async () => {
    const { default: editors } = await import('/src/store/useEditorStore.js');
    const { default: history } = await import('/src/store/useHistoryStore.js');
    const middle = 'An unchanged list item with enough text to wrap. '.repeat(6);
    editors.getState().openFile({
      path: '/list-alignment.md',
      name: 'list-alignment.md',
      content: `- First new item\n- ${middle}\n- Third new item`,
    });
    history.getState().setDiff({
      tabId: editors.getState().activeTabId,
      timestamp: 1,
      content: `- First old item\n- ${middle}\n- Third old item`,
    });
  });
  const preview = page.locator('.history-markdown-draft');
  const original = preview.locator('.history-markdown-draft__pane[data-side="original"]');
  const first = preview.locator('[data-direction="right"] [data-history-line="1"]');
  const third = preview.locator('[data-direction="right"] [data-history-line="3"]');
  await expect(preview).toHaveAttribute('data-aligned', '');
  await expect(first).toBeVisible();
  await expect(third).toBeVisible();
  const firstItem = await original.getByText('First old item').boundingBox();
  const thirdItem = await original.getByText('Third old item').boundingBox();
  const [firstArrow, thirdArrow] = await Promise.all([first.boundingBox(), third.boundingBox()]);
  expect(Math.abs(firstArrow.y - firstItem.y)).toBeLessThan(12);
  expect(Math.abs(thirdArrow.y - thirdItem.y)).toBeLessThan(12);
  expect(thirdArrow.y - firstArrow.y).toBeGreaterThan(48);
  await third.click();
  await expect(preview.locator('[data-side="modified"]').getByText('Third old item')).toBeVisible();
});

test('source comparison localizes both arrows and reverts added lines independently', async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  await page.evaluate(async () => {
    const { default: editors } = await import('/src/store/useEditorStore.js');
    const { default: history } = await import('/src/store/useHistoryStore.js');
    const { default: i18n } = await import('/src/i18n/index.js');
    await i18n.changeLanguage('zh');
    editors.getState().openFile({
      path: '/source-arrows.txt',
      name: 'source-arrows.txt',
      content: 'Before\nCurrent heading text\nShared tail',
    });
    history.getState().setDiff({
      tabId: editors.getState().activeTabId,
      timestamp: 1,
      content: 'Before\nFormer heading text\nShared tail',
    });
  });
  const diff = page.locator('.history-diff__editor');
  const right = diff.locator('.editor.modified');
  const line = right.locator('.view-line').filter({ hasText: 'Current heading text' });
  await line.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('New line A');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('New line B');
  const remove = diff.getByRole('button', { name: '撤销新增行' });
  const restore = diff.getByRole('button', { name: '撤销此处更改' });
  await expect(remove).toBeVisible();
  await expect(restore).toBeVisible();
  const pane = await right.boundingBox();
  const leftArrow = await remove.boundingBox();
  const rightArrow = await restore.boundingBox();
  expect(leftArrow.x + leftArrow.width).toBeLessThanOrEqual(pane.x + 0.5);
  expect(rightArrow.x).toBeGreaterThanOrEqual(pane.x - 0.5);
  await restore.hover();
  await expect(page.getByRole('tooltip').filter({ hasText: '撤销此处更改' })).toBeVisible();
  await page.evaluate(async () => {
    await (await import('/src/i18n/index.js')).default.changeLanguage('en');
  });
  await expect(diff.getByRole('button', { name: 'Revert change' })).toBeVisible();
  await diff.getByRole('button', { name: 'Revert added lines' }).click();
  await expect(right.locator('.view-line').filter({ hasText: /New line [AB]/ })).toHaveCount(0);
  await expect(line).toBeVisible();
});

test('Markdown comparison can edit the current draft in Milkdown and review it in both modes', async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  const initial = '# Current heading\n\nA draft paragraph.';
  await page.evaluate(async (content) => {
    const { default: editors } = await import('/src/store/useEditorStore.js');
    const { default: history } = await import('/src/store/useHistoryStore.js');
    let disk = content;
    window.__TAURI_INTERNALS__ = {
      invoke: async (command, args) => {
        if (command === 'read_file_content')
          return { success: true, content: disk, encoding: 'UTF-8' };
        if (command === 'save_file') {
          disk = args.content;
          window.historyDraftSaved = disk;
          return { success: true, file_path: args.filePath };
        }
        if (command === 'history_list') return [];
        return true;
      },
    };
    editors
      .getState()
      .openFile({ path: '/wysiwyg-history.md', name: 'wysiwyg-history.md', content });
    history.getState().setDiff({
      tabId: editors.getState().activeTabId,
      timestamp: 1,
      content: '# Former heading\n\nA draft paragraph.',
    });
  }, initial);
  const history = page.locator('.history-diff');
  const draft = history.locator('.history-markdown-draft');
  const milkdown = draft.locator('.milkdown-editor[contenteditable="true"]');
  const heading = milkdown.getByRole('heading', { name: 'Current heading' });
  const former = draft
    .locator('.milkdown-editor[contenteditable="false"]')
    .getByRole('heading', { name: 'Former heading' });
  await expect(former).toBeVisible();
  await expect(heading).toBeVisible();
  expect(Math.abs((await former.boundingBox()).y - (await heading.boundingBox()).y)).toBeLessThan(
    2,
  );
  await expect(draft.locator('[data-change="removed"]')).toBeVisible();
  await expect(draft.locator('[data-change="added"]')).toBeVisible();
  await expect(draft.locator('.history-markdown-diff__revert')).toBeVisible();
  await heading.click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(' revised');
  await expect(milkdown.getByRole('heading', { name: 'Current heading revised' })).toBeVisible();
  await page.getByRole('button', { name: /切换工具栏|Toggle toolbar/ }).click();
  await milkdown.getByText('A draft paragraph.', { exact: true }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await page
    .locator('.ft--show')
    .getByRole('button', { name: /粗体|Bold/ })
    .click();
  await expect(milkdown.locator('strong')).toHaveText('A draft paragraph.');
  await expect(history.locator('.history-diff__actions .ant-btn-primary')).toBeEnabled();
  expect(
    await page.evaluate(async () => {
      const { getBuffer } = await import('/src/utils/editorBuffer.js');
      const { default: editors } = await import('/src/store/useEditorStore.js');
      return getBuffer(editors.getState().activeTabId);
    }),
  ).toBe(initial);
  await page.locator('.footer__left .footer__mode-toggle').click();
  await expect(
    history.locator('.editor.modified .view-line').filter({ hasText: 'Current heading revised' }),
  ).toBeVisible();
  await page.locator('.footer__left .footer__mode-toggle').click();
  await expect(milkdown.getByRole('heading', { name: 'Current heading revised' })).toBeVisible();
  await expect(milkdown.locator('strong')).toHaveText('A draft paragraph.');
  await page.keyboard.press('Control+z');
  await expect(milkdown.locator('strong')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(milkdown.locator('strong')).toHaveText('A draft paragraph.');
  expect(await page.evaluate(() => window.historyDraftSaved)).toBeUndefined();
  await history.locator('.history-diff__actions .ant-btn-primary').click();
  await expect(history).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.historyDraftSaved))
    .toContain('# Current heading revised\n\n**A draft paragraph.**');
});

test('Markdown history and plugin comparisons open rendered and share the footer mode switch', async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  await page.evaluate(async () => {
    const { default: editors } = await import('/src/store/useEditorStore.js');
    const { default: history } = await import('/src/store/useHistoryStore.js');
    editors.getState().openFile({
      path: '/comparison.md',
      name: 'comparison.md',
      content: '# Current heading\n\n- [x] Present task',
    });
    const tabId = editors.getState().activeTabId;
    history
      .getState()
      .setDiff({ tabId, timestamp: 1, content: '# Former heading\n\n- [ ] Earlier task' });
  });
  const history = page.locator('.history-diff');
  const footerMode = page.locator('.footer__left .footer__mode-toggle');
  await expect(history.getByRole('heading', { name: 'Former heading' })).toBeVisible();
  await expect(history.getByRole('heading', { name: 'Current heading' })).toBeVisible();
  await expect(history.locator('.history-diff__editor')).toBeHidden();
  await footerMode.click();
  await expect(history.locator('.history-diff__editor')).toBeVisible();
  await expect(history.getByRole('heading', { name: 'Former heading' })).toHaveCount(0);
  const apply = history.locator('.history-diff__actions .ant-btn-primary');
  await expect(apply).toBeDisabled();
  const changedLine = history
    .locator('.editor.modified .view-line')
    .filter({ hasText: 'Current heading' });
  await changedLine.click();
  await page.keyboard.press('Home');
  await expect(apply).toBeDisabled();
  await page.keyboard.press('Shift+End');
  await expect(apply).toBeEnabled();
  await expect(apply).toHaveAccessibleName(/应用选中差异|Apply selected changes/);
  await page.keyboard.press('ArrowRight');
  await expect(apply).toBeDisabled();
  await footerMode.click();
  await expect(history.getByRole('heading', { name: 'Former heading' })).toBeVisible();
  await footerMode.click();
  await page.evaluate(async () => {
    const { default: history } = await import('/src/store/useHistoryStore.js');
    const { diff, setDiff } = history.getState();
    setDiff({
      ...diff,
      content: '# Cloud heading',
      pluginId: 'fixture.generic',
      label: 'Cloud comparison',
    });
  });
  await expect(history.getByRole('heading', { name: 'Cloud heading' })).toBeVisible();
  await expect(history.locator('.history-diff__editor')).toBeHidden();
});

test('Markdown history keeps HTML, tables and fenced code intact and folds unchanged blocks', async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  await page.evaluate(async () => {
    const { default: editors } = await import('/src/store/useEditorStore.js');
    const { default: history } = await import('/src/store/useHistoryStore.js');
    const { default: i18n } = await import('/src/i18n/index.js');
    await i18n.changeLanguage('zh');
    const shared = [
      '<p align="center">',
      '  <img alt="Project logo" width="200" height="200" src="/src/assets/characters/moki-icon.png">',
      '</p>',
      '',
      '<h1 align="center">Project title</h1>',
      '',
      '<p align="center">',
      '  <a href="https://example.test/license"><img alt="License badge" width="24" height="24" src="/src/assets/characters/moki-icon.png"></a>',
      '  <img alt="Build badge" width="24" height="24" src="/src/assets/characters/moki-icon.png">',
      '</p>',
      '',
      '<p align="center">',
      '  <a href="https://example.test/docs">Docs</a> ·',
      '  <a href="https://example.test/download">Download</a>',
      '</p>',
      '',
      '| Option | Value |',
      '| --- | --- |',
      '| First | A |',
      '| Second | B |',
      '',
      '~~~csharp',
      'try {',
      '  Console.WriteLine("Kept");',
      '} finally {',
      '}',
      '~~~',
      '',
    ].join('\n');
    editors.getState().openFile({
      path: '/rendered.md',
      name: 'rendered.md',
      content:
        '# New intro\n\n' +
        shared.replace('| First | A |', '| First     | A   |') +
        '\n# New footer',
    });
    history.getState().setDiff({
      tabId: editors.getState().activeTabId,
      timestamp: 1,
      content: '# Old intro\n\n' + shared + '\n# Old footer',
    });
  });
  const preview = page.locator('.history-markdown-diff');
  const folds = preview.locator('.history-markdown-diff__fold');
  await expect(folds).toHaveCount(2, { timeout: 15000 });
  const dividerOffset = () =>
    page.evaluate(() => {
      const header = document.querySelector('.history-diff__file');
      const body = document.querySelector('.history-markdown-diff__cell[data-side="original"]');
      return Math.abs(header.getBoundingClientRect().right - body.getBoundingClientRect().right);
    });
  await expect.poll(dividerOffset).toBeLessThan(0.5);
  const label = await folds.first().innerText();
  expect(label).toMatch(/已隐藏 \d+ 行/);
  await expect(folds.last()).toHaveText(label);
  const footerMode = page.locator('.footer__left .footer__mode-toggle');
  await footerMode.click();
  const source = page.locator('.history-diff__editor');
  const center = source.locator('.diff-hidden-lines .center').first();
  await expect(center).toContainText(/已隐藏 \d+ 行/);
  await center.locator('a[role="button"]').click();
  await source.locator('.fold-unchanged').first().hover();
  await expect(page.locator('.ant-tooltip-inner').getByText('折叠未更改区域')).toBeVisible();
  await footerMode.click();
  await folds.first().click();
  const collapseFold = preview.locator('.history-markdown-diff__fold-action');
  await expect(folds).toHaveCount(0);
  await expect(collapseFold).toHaveCount(2);
  await expect(collapseFold.first()).toBeVisible();
  await expect(collapseFold.last()).toBeVisible();
  await preview.locator('.history-markdown-diff__fold-action[data-side="modified"]').click();
  await expect(folds).toHaveCount(2);
  await page
    .getByRole('button', { name: /全部展开未更改内容|Expand all unchanged regions/ })
    .click();
  await expect(preview.locator('.history-markdown-diff__fold[aria-expanded="false"]')).toHaveCount(
    0,
  );
  await page
    .getByRole('button', { name: /全部折叠未更改内容|Collapse all unchanged regions/ })
    .click();
  await expect(folds.first()).toHaveAttribute('aria-expanded', 'false');
  await page
    .getByRole('button', { name: /全部展开未更改内容|Expand all unchanged regions/ })
    .click();
  await expect.poll(dividerOffset).toBeLessThan(0.5);
  for (const side of ['original', 'modified']) {
    const pane = preview.locator(`.history-markdown-draft__pane[data-side="${side}"]`);
    const logo = pane.getByRole('img', { name: 'Project logo' });
    await expect(logo.locator('..')).toHaveAttribute('align', 'center');
    const logoBox = await logo.boundingBox();
    const titleBox = await pane.getByRole('heading', { name: 'Project title' }).boundingBox();
    expect(logoBox.y + logoBox.height).toBeLessThanOrEqual(titleBox.y);
    await logo.click();
    const lightbox = page.locator('.milkdown-media-preview-host');
    const enlarged = lightbox.locator('.ant-image-preview-img');
    await expect(enlarged).toBeVisible();
    await expect.poll(() => enlarged.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
    const comparisonBounds = await page.locator('.history-diff').boundingBox();
    const maskBounds = await lightbox.locator('.ant-image-preview-mask').boundingBox();
    for (const edge of ['x', 'y', 'width', 'height']) {
      expect(maskBounds[edge]).toBeCloseTo(comparisonBounds[edge], 0);
    }
    await page.keyboard.press('Escape');
    await expect(lightbox).toHaveCount(0);
    const docs = pane.getByRole('link', { name: 'Docs' });
    const download = pane.getByRole('link', { name: 'Download' });
    const docsBox = await docs.boundingBox();
    const downloadBox = await download.boundingBox();
    expect(docsBox.y).toBe(downloadBox.y);
    const license = await pane.getByRole('img', { name: 'License badge' }).boundingBox();
    const build = await pane.getByRole('img', { name: 'Build badge' }).boundingBox();
    expect(license.y).toBe(build.y);
    expect(license.x).toBeLessThan(build.x);
    await expect(pane.getByRole('table').getByRole('row')).toHaveCount(3);
    const code = pane.locator('.cm-content');
    await expect(code).toContainText('Console.WriteLine("Kept")');
    await expect(code).not.toContainText('~~~');
  }
  await footerMode.click();
  await expect(page.locator('.history-diff__editor .diff-hidden-lines .center')).toHaveCount(0);
  await footerMode.click();
  const revert = preview.locator('.history-markdown-diff__revert').first();
  await expect(revert.locator('.codicon-arrow-right')).toHaveCount(1);
  const changedRow = revert.locator('xpath=ancestor::*[@data-history-row]');
  const arrowBox = await revert.boundingBox();
  for (const side of ['original', 'modified']) {
    const pane = changedRow.locator(`[data-side="${side}"]`);
    const marker = pane.locator('.history-markdown-diff__marker');
    await expect(marker).toHaveText(side === 'original' ? '−' : '+');
    const markerBox = await marker.boundingBox();
    const contentBox = await preview
      .locator(`.history-markdown-draft__pane[data-side="${side}"] .milkdown-editor`)
      .boundingBox();
    expect(markerBox.x + markerBox.width).toBeLessThanOrEqual(contentBox.x);
    if (side === 'modified') {
      const paneBox = await pane.boundingBox();
      expect(arrowBox.x).toBeGreaterThanOrEqual(paneBox.x);
      expect(arrowBox.x + arrowBox.width).toBeLessThan(markerBox.x);
    }
  }
  await revert.click();
  await expect(
    preview.locator('.milkdown-editor[contenteditable="true"] > h1').first(),
  ).toContainText('Old intro');
  await expect(preview.getByRole('heading', { name: 'New footer' })).toBeVisible();
});

test('Markdown history stripes the missing side of an insertion or deletion', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 30000 });
  await page.evaluate(async () => {
    const { default: editors } = await import('/src/store/useEditorStore.js');
    const { default: history } = await import('/src/store/useHistoryStore.js');
    editors.getState().openFile({
      path: '/gaps.md',
      name: 'gaps.md',
      content: '# Intro\n# Shared\n# Anchor\n# Inserted\n# End',
    });
    history.getState().setDiff({
      tabId: editors.getState().activeTabId,
      timestamp: 1,
      content: '# Intro\n\n# Deleted\n\nA second deleted block.\n\n# Shared\n# Anchor\n# End',
    });
  });
  const preview = page.locator('.history-markdown-diff');
  const deletion = preview.locator('.history-markdown-diff__row').filter({
    has: page.getByRole('heading', { name: 'Deleted', exact: true }),
  });
  const insertion = preview.locator('.history-markdown-diff__row').filter({
    has: page.locator('[data-side="original"][data-gap]'),
  });
  await expect(deletion.locator('[data-side="modified"][data-gap]')).toHaveCSS(
    'background-image',
    /repeating-linear-gradient/,
  );
  await expect(preview.locator('[data-side="modified"][data-gap]')).toHaveCount(1);
  await expect(deletion.getByText('A second deleted block.')).toBeVisible();
  const toolbarAlpha = await page
    .locator('.history-diff__actions .ant-btn-default')
    .first()
    .evaluate((button) => {
      const context = document.createElement('canvas').getContext('2d');
      context.fillStyle = getComputedStyle(button).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[3];
    });
  expect(toolbarAlpha).toBeGreaterThan(0);
  expect(toolbarAlpha).toBeLessThan(255);
  await expect(insertion.locator('[data-side="original"][data-gap]')).toHaveCSS(
    'background-image',
    /repeating-linear-gradient/,
  );
  await deletion.locator('.history-markdown-diff__revert').click();
  await expect(preview.locator('.milkdown-editor h1').filter({ hasText: 'Deleted' })).toHaveCount(
    1,
  );
  await expect(preview.locator('[data-side="modified"][data-gap]')).toHaveCount(0);
  await expect(insertion.locator('[data-side="original"][data-gap]')).toBeVisible();
  const remove = insertion.locator('.history-markdown-diff__revert');
  await expect(remove.locator('.codicon-arrow-left')).toHaveCount(1);
  const gap = await insertion.locator('[data-side="original"][data-gap]').boundingBox();
  const arrow = await remove.boundingBox();
  expect(arrow.x + arrow.width).toBeLessThanOrEqual(gap.x + gap.width + 0.5);
  await remove.click();
  await expect(preview.getByRole('heading', { name: 'Inserted', exact: true })).toHaveCount(0);
  await expect(page.locator('.history-diff__empty')).toContainText(/没有更改|No changes/);
  await expect(preview.locator('.history-markdown-diff__fold, [data-change]')).toHaveCount(0);
  await expect(preview).toBeHidden();
  await expect(page.locator('.history-diff__actions .ant-btn-primary')).toBeEnabled();
});
