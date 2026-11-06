import { expect, test } from '@playwright/test';

test('new filename appears at the selected collapsed directory end and writes there', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/tests/fixtures/project-explorer.html?features=1');
  const tree = page.getByRole('tree');
  const src = tree.getByRole('treeitem', { name: 'src', exact: true });
  await src.click();
  await expect(tree.getByRole('treeitem', { name: 'readme.txt', exact: true })).toBeVisible();
  await src.click();
  await expect(src).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'New file', exact: true }).click();
  const draft = tree.locator('[data-parent-path="/workspace/demo/src"]');
  const input = draft.locator('input.file-tree__name-input');
  await expect(input).toBeVisible(); await expect(input).toBeFocused();
  await expect(src).toHaveAttribute('aria-expanded', 'true');
  const last = tree.getByRole('treeitem', { name: 'readme.txt', exact: true });
  expect(Math.abs((await draft.boundingBox()).y - (await last.boundingBox()).y - 32)).toBeLessThan(1);
  await input.fill('inside-src'); await input.press('Enter');
  await expect.poll(() => page.evaluate(() => window.projectFixture.writes)).toEqual(['/workspace/demo/src/inside-src.md']);
  await expect(tree.getByRole('treeitem', { name: 'inside-src.md', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('root draft follows the last file and collapsed root blocks creation', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/tests/fixtures/project-explorer.html');
  const tree = page.getByRole('tree');
  await expect(tree.getByRole('treeitem', { name: 'src', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New file', exact: true }).click();
  const draft = tree.locator('[data-parent-path="/workspace/demo"]');
  const input = draft.locator('input.file-tree__name-input');
  await expect(input).toBeVisible();
  const last = tree.getByRole('treeitem', { name: 'note8999.md', exact: true });
  await expect(last).toBeVisible();
  expect(Math.abs((await draft.boundingBox()).y - (await last.boundingBox()).y - 32)).toBeLessThan(1);
  await input.press('Escape');
  await tree.focus(); await page.keyboard.press('Home');
  await tree.getByRole('treeitem', { name: 'demo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New file', exact: true })).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('explorer:newFileRequest')));
  await expect(tree.locator('.file-tree__name-input')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('project search unfolds ancestors and reveals a match beyond the viewport width', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/tests/fixtures/project-explorer.html?features=1');
  const tree = page.getByRole('tree');
  await tree.getByRole('treeitem', { name: 'demo', exact: true }).click();
  await page.getByRole('button', { name: /搜索文件名|Search filenames/, exact: true }).click();
  await page.getByRole('textbox', { name: /搜索文件名|Search filenames/ }).fill('NeedleTail');
  await expect(page.locator('.explorer-search__count')).toHaveText('1/1');
  const selected = tree.locator('[aria-selected=true]');
  await expect(selected).toContainText('NeedleTail');
  await expect.poll(() => tree.evaluate((node) => node.scrollLeft)).toBeGreaterThan(100);
  const mark = selected.locator('.explorer-match');
  await expect.poll(async () => {
    const bounds = await tree.boundingBox(), hit = await mark.boundingBox();
    return hit.x >= bounds.x && hit.x + hit.width <= bounds.x + bounds.width;
  }).toBe(true);
  // Horizontal position stays usable while expanding/collapsing elsewhere.
  await tree.evaluate((node) => { node.scrollLeft = 0; });
  await tree.focus(); await page.keyboard.press('Home');
  await expect(tree.getByRole('treeitem', { name: 'src', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(tree.getByRole('treeitem', { name: 'nested', exact: true })).toHaveAttribute('aria-expanded', 'true');
  expect(errors).toEqual([]);
});

test('both modes scroll long filenames horizontally and denied-folder widths remain stable', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/tests/fixtures/project-explorer.html?features=1');
  const tree = page.getByRole('tree');
  await tree.getByRole('treeitem', { name: 'empty', exact: true }).click();
  await expect(tree.getByText(/此文件夹为空|This folder is empty/)).toHaveCount(0);
  await tree.getByRole('treeitem', { name: 'denied', exact: true }).click();
  await expect(tree.getByRole('alert')).toContainText('Access denied');
  const widths = await tree.evaluate(async (node) => {
    const widths = [];
    for (let index = 0; index < 10; index++) { await new Promise(requestAnimationFrame); widths.push(node.scrollWidth); }
    return widths;
  });
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(2);
  expect(widths[0]).toBeGreaterThan(300);
  await page.getByRole('button', { name: 'Toggle mode' }).click();
  const list = page.getByRole('list');
  await expect(list.getByText(/wide-root-/)).toBeVisible();
  const dimensions = await list.evaluate((node) => ({ content: node.scrollWidth, width: node.clientWidth }));
  expect(dimensions.content).toBeGreaterThan(dimensions.width);
  await list.evaluate((node) => { node.scrollLeft = 180; });
  expect(await list.evaluate((node) => node.scrollLeft)).toBe(180);
  for (const width of [240, 430, 280, 360]) {
    await page.locator('.sidebar__view').evaluate((node, width) => { node.style.width = `${width}px`; }, width);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  expect(errors).toEqual([]);
});

test('new-file input and extension measurements settle without ResizeObserver errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/tests/fixtures/project-explorer.html?features=1');
  const tree = page.getByRole('tree');
  await tree.getByRole('treeitem', { name: 'src', exact: true }).click();
  await page.getByRole('button', { name: 'New file', exact: true }).click();
  const draft = tree.locator('.file-tree__item--creating');
  const input = draft.locator('input.file-tree__name-input');
  await expect(input).toBeVisible();
  // Leave the empty field mounted through multiple observer deliveries; a
  // padding/intrinsic-width feedback loop used to grow on every notification.
  const measure = () => tree.evaluate(async (node) => {
    const values = [];
    for (let index = 0; index < 20; index++) { await new Promise(requestAnimationFrame); values.push(node.scrollWidth); }
    return values;
  });
  let widths = await measure();
  expect(Math.max(...widths.slice(5)) - Math.min(...widths.slice(5))).toBeLessThan(2);
  await input.fill('中文文件名以及更长的名称'.repeat(16));
  const extension = draft.getByRole('combobox');
  await extension.fill('.markdown');
  await expect(input).toBeVisible();
  await input.focus();
  for (const [width, zoom] of [[240, 1.25], [430, .9], [300, 1]]) {
    await page.locator('.sidebar__view').evaluate((node, { width, zoom }) => { node.style.width = `${width}px`; node.style.zoom = zoom; }, { width, zoom });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  widths = await measure();
  expect(Math.max(...widths.slice(5)) - Math.min(...widths.slice(5))).toBeLessThan(2);
  await expect(input).toBeVisible();
  await input.press('Escape');
  await expect(draft).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('new-file focus aligns horizontally with its parent folder instead of the tree root', async ({ page }) => {
  await page.goto('/tests/fixtures/project-explorer.html?features=1');
  const tree = page.getByRole('tree');
  await tree.getByRole('treeitem', { name: 'src', exact: true }).click();
  const parent = tree.getByRole('treeitem', { name: 'nested', exact: true });
  await parent.click();
  await expect(tree.getByText(/NeedleTail/)).toBeVisible();
  await tree.evaluate((node) => { node.scrollLeft = 600; });
  await page.getByRole('button', { name: 'New file', exact: true }).click();
  const input = tree.locator('.file-tree__name-input');
  await expect(input).toBeVisible(); await expect(input).toBeFocused();
  await expect.poll(() => tree.evaluate((node) => node.scrollLeft)).toBe(32);
  const bounds = await tree.boundingBox(), toggle = await parent.getByRole('button').boundingBox();
  expect(Math.abs(toggle.x - bounds.x - 8)).toBeLessThan(1);
  const label = await parent.locator('.project-tree__name').boundingBox(), name = await input.boundingBox();
  expect(Math.abs(name.x - label.x - 16)).toBeLessThan(1);
});

test('creating inside an initially empty folder restores its arrow even after collapse', async ({ page }) => {
  await page.goto('/tests/fixtures/project-explorer.html?features=1');
  const tree = page.getByRole('tree');
  const empty = tree.locator('[data-path="/workspace/demo/empty"]');
  await expect(empty.getByRole('button')).toHaveCount(0);
  await empty.click();
  await page.getByRole('button', { name: 'New file', exact: true }).click();
  const input = tree.locator('.file-tree__name-input');
  await expect(input).toBeVisible();
  await input.fill('first'); await input.press('Enter');
  await expect(tree.getByRole('treeitem', { name: 'first.md', exact: true })).toBeVisible();
  await expect(empty.getByRole('button')).toHaveCount(1);
  await empty.click();
  await expect(empty).toHaveAttribute('aria-expanded', 'false');
  await expect(empty.getByRole('button')).toHaveCount(1);
});

test('empty-folder naming immediately opens the folder and cancelling restores its empty state', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/tests/fixtures/project-explorer.html?features=1');
  const tree = page.getByRole('tree'), empty = tree.locator('[data-path="/workspace/demo/empty"]');
  await empty.click();
  await expect(empty.getByRole('button')).toHaveCount(0);
  await page.getByRole('button', { name: 'New file', exact: true }).click();
  const input = tree.locator('.file-tree__name-input');
  await expect(input).toBeVisible();
  await expect(empty).toHaveAttribute('aria-expanded', 'true');
  await expect(empty.getByRole('button')).toHaveCount(1);
  await expect(empty.getByRole('button')).toHaveClass(/project-tree__toggle--expanded/);
  await input.press('Escape');
  await expect(tree.locator('.file-tree__name-field')).toHaveCount(0);
  await expect(empty).toHaveAttribute('aria-expanded', 'false');
  await expect(empty.getByRole('button')).toHaveCount(0);
  await page.getByRole('button', { name: 'New file', exact: true }).click();
  await expect(input).toBeVisible();
  await input.press('Escape');
  expect(await page.evaluate(() => window.projectFixture.writes)).toEqual([]);
  expect(errors).toEqual([]);
});

test('read and write permission failures leave no stale new-file input and allow a later creation', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/tests/fixtures/project-explorer.html?features=1');
  const tree = page.getByRole('tree'), denied = tree.locator('[data-path="/workspace/demo/denied"]');
  await denied.click();
  await expect(tree.getByRole('alert')).toContainText('Access denied');
  await denied.click();
  await page.getByRole('button', { name: 'New file', exact: true }).click();
  await expect(page.locator('.project-tree > [role=alert]')).toContainText('Access denied');
  await expect(tree.locator('.file-tree__name-field')).toHaveCount(0);
  await expect(denied).toHaveAttribute('aria-expanded', 'false');
  await expect(denied.getByRole('button')).toHaveClass(/--error/);
  await tree.getByRole('treeitem', { name: 'src', exact: true }).click();
  await page.evaluate(() => { window.projectFixture.denyWrites = true; });
  await page.getByRole('button', { name: 'New file', exact: true }).click();
  const input = tree.locator('.file-tree__name-input');
  await expect(input).toBeVisible(); await input.fill('forbidden'); await input.press('Enter');
  await expect(tree.locator('.file-tree__name-field')).toHaveCount(0);
  await page.evaluate(() => { window.projectFixture.denyWrites = false; });
  await page.getByRole('button', { name: 'New file', exact: true }).click();
  await expect(input).toHaveCount(1); await input.fill('allowed'); await input.press('Enter');
  await expect(tree.getByRole('treeitem', { name: 'allowed.md', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.projectFixture.writes)).toEqual(['/workspace/demo/src/allowed.md']);
  expect(errors).toEqual([]);
});
