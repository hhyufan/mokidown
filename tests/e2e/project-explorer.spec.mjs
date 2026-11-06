import { expect, test } from '@playwright/test';

test('search selection has one active row while the editor current file keeps a separate marker', async ({ page }) => {
  await page.goto('/tests/fixtures/project-explorer.html');
  const tree = page.getByRole('tree');
  await tree.getByRole('treeitem', { name: 'src', exact: true }).click();
  const opened = tree.locator('[data-path="/workspace/demo/src/README.md"]');
  const target = tree.locator('[data-path="/workspace/demo/src/readme.txt"]');
  await target.click();
  await opened.click();
  await expect(opened).toHaveAttribute('aria-current', 'true');
  await expect(tree.locator('.project-tree__row--active')).toHaveCount(1);
  await page.getByRole('button', { name: /搜索文件名|Search filenames/, exact: true }).click();
  await page.getByRole('textbox', { name: /搜索文件名|Search filenames/ }).fill('readme');
  await expect(page.locator('.explorer-search__count')).toHaveText('1/6');
  await page.getByRole('button', { name: /下一个匹配项|Next match/ }).click();
  await expect(target).toHaveAttribute('aria-selected', 'true');
  await expect(tree.locator('.project-tree__row--active')).toHaveCount(1);
  await expect(opened).not.toHaveClass(/project-tree__row--active/);
  await expect(opened).toHaveAttribute('aria-current', 'true');
  expect(await tree.locator('.file-tree__current-indicator').evaluate((marker) => getComputedStyle(marker).width)).toBe('2px');
  expect(await page.evaluate(() => window.projectFixture.useEditorStore.getState().activeTabId)).toBe('/workspace/demo/src/README.md');
  // A folder selection is also exclusive and does not change the editor file.
  await tree.getByRole('treeitem', { name: 'docs', exact: true }).click();
  await expect(tree.locator('.project-tree__row--active')).toHaveCount(1);
  await expect(opened).toHaveAttribute('aria-current', 'true');
  await page.evaluate(() => window.projectFixture.useEditorStore.getState().setActiveTab('/workspace/demo/src/readme.txt'));
  await expect(target).toHaveAttribute('aria-current', 'true');
  await expect(target).toHaveAttribute('aria-selected', 'true');
  await expect(tree.locator('.project-tree__row--active')).toHaveCount(1);
  await opened.click();
  await expect(opened).toHaveAttribute('aria-selected', 'true');
  await expect(tree.locator('.project-tree__row--active')).toHaveCount(1);
});

test('child directory indicators are ready when the parent expands and focus has no native black outline', async ({ page }) => {
  await page.goto('/tests/fixtures/project-explorer.html?features=1');
  const tree = page.getByRole('tree');
  const empty = tree.locator('[data-path="/workspace/demo/empty"]');
  const denied = tree.locator('[data-path="/workspace/demo/denied"]');
  await expect(empty).toBeVisible();
  await expect(empty.getByRole('button')).toHaveCount(0);
  await expect(denied.getByRole('button')).toHaveClass(/project-tree__toggle--error/);
  await expect(denied).toHaveAttribute('aria-expanded', 'false');
  await tree.getByRole('treeitem', { name: 'src', exact: true }).click();
  const childEmpty = tree.locator('[data-path="/workspace/demo/src/empty"]');
  const childDenied = tree.locator('[data-path="/workspace/demo/src/denied"]');
  await expect(childEmpty).toBeVisible();
  await expect(childEmpty.getByRole('button')).toHaveCount(0);
  await expect(childDenied.getByRole('button')).toHaveClass(/project-tree__toggle--error/);
  await expect(childDenied).toHaveAttribute('aria-expanded', 'false');
  await tree.focus();
  const focus = await tree.evaluate((node) => ({ outline: getComputedStyle(node).outlineStyle, shadow: getComputedStyle(node).boxShadow }));
  expect(focus.outline).toBe('none');
  expect(focus.shadow === 'none' || focus.shadow.includes('120, 178, 255')).toBe(true);
});

test('collapsing wide descendants removes their horizontal scrollbar', async ({ page }) => {
  await page.goto('/tests/fixtures/project-explorer.html?features=1');
  const tree = page.getByRole('tree');
  await tree.getByRole('treeitem', { name: 'src', exact: true }).click();
  await tree.getByRole('treeitem', { name: 'nested', exact: true }).click();
  await expect(tree.getByText(/NeedleTail/)).toBeVisible();
  await expect.poll(() => tree.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  await tree.evaluate((node) => { node.scrollLeft = 450; });
  await page.getByRole('button', { name: /折叠所有.*文件夹|Collapse all (sub)?folders/ }).click();
  await expect(tree.getByRole('treeitem')).toHaveCount(1);
  await expect.poll(() => tree.evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
  expect(await tree.evaluate((node) => node.scrollLeft)).toBe(0);
  // Expanding it again must still recover the full natural width.
  await tree.getByRole('treeitem', { name: 'demo', exact: true }).click();
  await expect.poll(() => tree.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
});

test('project controls, persistent search drawer, filename navigation and root selection', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/tests/fixtures/project-explorer.html');
  const tree = page.getByRole('tree');
  await expect(tree.getByRole('treeitem', { name: 'demo', exact: true })).toBeVisible();
  await expect(tree.getByRole('treeitem', { name: 'src', exact: true })).toBeVisible();
  expect(await tree.getByRole('treeitem', { name: 'demo', exact: true }).getByRole('button').count()).toBe(1);
  await expect(page.getByRole('button', { name: /后退|Back/, exact: true })).toHaveCount(0);
  const expand = page.getByRole('button', { name: /展开所选文件夹|Expand selected folder/ });
  await expect(expand).toBeVisible();
  expect(await expand.evaluate((node) => node.closest('.file-tree__nav') !== null)).toBe(true);
  await page.getByRole('button', { name: /搜索文件名|Search filenames/, exact: true }).click();
  const input = page.getByRole('textbox', { name: /搜索文件名|Search filenames/ });
  await input.fill('README');
  await expect(page.locator('.explorer-search__count')).toHaveText('1/6');
  await expect(tree.locator('[aria-selected=true]')).toContainText(/readme/i);
  await page.getByRole('button', { name: /区分大小写|Case sensitive|Match case/i }).click();
  await expect(page.locator('.explorer-search__count')).toHaveText('1/3');
  await page.getByRole('button', { name: /下一个匹配项|Next match/ }).click();
  await expect(page.locator('.explorer-search__count')).toHaveText('2/3');
  await input.fill('');
  await tree.focus(); await page.keyboard.press('Home');
  const src = tree.getByRole('treeitem', { name: 'src', exact: true });
  await src.click();
  const down = page.getByRole('button', { name: /所选文件夹设为项目根目录|Use selected folder as project root/ });
  await expect(down).toBeEnabled(); await down.click();
  await expect(tree.getByRole('treeitem', { name: 'src', exact: true })).toHaveAttribute('aria-level', '1');
  await expect(down).toBeDisabled();
  await page.getByRole('button', { name: /上一级|Up/, exact: true }).click();
  await expect(tree.getByRole('treeitem', { name: 'demo', exact: true })).toHaveAttribute('aria-level', '1');
  await expect(tree.getByRole('treeitem', { name: 'src', exact: true })).toHaveAttribute('aria-expanded', 'true');
  expect(await tree.evaluate((node) => node.scrollTop)).toBe(0);
  await page.getByRole('button', { name: 'Toggle mode' }).click();
  await expect(page.getByRole('list')).toBeVisible();
  await expect(page.getByRole('button', { name: /后退|Back/, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Toggle mode' }).click();
  await expect(tree).toBeVisible();
  expect(errors).toEqual([]);
});

test('high-speed project scrolling keeps mapped SVG icons and bounded rows', async ({ page }) => {
  await page.goto('/tests/fixtures/project-explorer.html');
  const tree = page.getByRole('tree');
  await expect(tree.getByRole('treeitem', { name: 'src', exact: true })).toBeVisible();
  await tree.focus(); await page.keyboard.press('End');
  const last = tree.getByRole('treeitem', { name: 'note8999.md', exact: true });
  await expect(last).toBeVisible();
  await expect(last.locator('.project-tree__icon img')).toHaveAttribute('src', /markdown/);
  expect(await tree.getByRole('treeitem').count()).toBeLessThan(80);
  await page.keyboard.press('Home');
  const src = tree.getByRole('treeitem', { name: 'src', exact: true });
  await expect(src).toBeVisible();
  await expect(src.locator('.project-tree__icon img')).toHaveAttribute('src', /folder-src/);
});

test('Up reveals the new root at the top even when the former root sorts far below it', async ({ page }) => {
  await page.goto('/tests/fixtures/project-explorer.html?far=1');
  const tree = page.getByRole('tree');
  await expect(tree.getByRole('treeitem', { name: 'src', exact: true })).toBeVisible();
  await tree.focus(); await page.keyboard.press('End');
  await expect(tree.getByRole('treeitem', { name: 'note8999.md', exact: true })).toBeVisible();
  const originalTree = await tree.elementHandle();
  await page.evaluate(() => {
    window.rootTransitionFrames = [];
    const start = performance.now();
    const sample = () => {
      const canvas = document.querySelector('.project-tree__body > .project-tree__canvas');
      const overlay = document.querySelector('.project-tree__overlay');
      const resident = canvas.querySelectorAll('[data-path]').length > 0 && Number(getComputedStyle(canvas).opacity) > .02;
      const snapshot = overlay.childElementCount > 0 && Number(getComputedStyle(overlay).opacity) > .02;
      window.rootTransitionFrames.push(resident || snapshot);
      if (performance.now() - start < 900) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.getByRole('button', { name: /上一级|Up/, exact: true }).click();
  const root = tree.getByRole('treeitem', { name: 'workspace', exact: true });
  await expect(root).toBeVisible();
  await expect(root).toHaveAttribute('aria-level', '1');
  expect(await tree.evaluate((node) => node.scrollTop)).toBe(0);
  await expect(page.locator('.project-tree__overlay > *')).toHaveCount(0);
  expect(await originalTree.evaluate((node) => node.isConnected)).toBe(true);
  expect(await page.evaluate(() => window.rootTransitionFrames.every(Boolean))).toBe(true);
  await expect(root).toBeVisible();
  await expect(tree.getByRole('treeitem', { name: 'demo', exact: true })).toHaveCount(0);
});
