import { expect, test } from '@playwright/test';

const switchFile = async (page, path) => page.evaluate(async (path) => {
  window.projectFixture.useEditorStore.getState().setActiveTab(path);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}, path);

test('cross-folder marker shrinks vertically around its center before expanding at the destination', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/tests/fixtures/project-explorer.html');
  const tree = page.getByRole('tree'), marker = tree.locator('.file-tree__current-indicator');
  await tree.getByRole('treeitem', { name: 'src', exact: true }).click();
  await tree.getByRole('treeitem', { name: 'docs', exact: true }).click();
  await switchFile(page, '/workspace/demo/src/README.md');
  await expect(marker).toHaveAttribute('data-motion', 'idle');
  const before = await marker.boundingBox();
  await switchFile(page, '/workspace/demo/docs/README.md');
  await expect(marker).toHaveAttribute('data-motion', 'exit');
  const middle = await marker.evaluate((element) => {
    const effect = element.getAnimations()[0];
    effect.pause(); effect.currentTime = Number(effect.effect.getTiming().duration) / 2;
    const box = element.getBoundingClientRect();
    return { height: box.height, center: box.y + box.height / 2, x: box.x, opacity: Number(getComputedStyle(element).opacity) };
  });
  expect(middle.height).toBeGreaterThan(2); expect(middle.height).toBeLessThan(14);
  expect(Math.abs(middle.center - before.y - before.height / 2)).toBeLessThan(1);
  expect(Math.abs(middle.x - before.x)).toBeLessThan(1);
  expect(middle.opacity).toBeGreaterThan(0); expect(middle.opacity).toBeLessThan(1);
  await marker.evaluate((element) => element.getAnimations()[0].play());
  await expect(marker).toHaveAttribute('data-motion', 'enter');
  const growing = await marker.evaluate((element) => {
    const effect = element.getAnimations()[0];
    effect.pause(); effect.currentTime = Number(effect.effect.getTiming().duration) / 2;
    const box = element.getBoundingClientRect(); effect.play();
    return { height: box.height, center: box.y + box.height / 2 };
  });
  expect(growing.height).toBeGreaterThan(2); expect(growing.height).toBeLessThan(14);
  await expect(marker).toHaveAttribute('data-motion', 'idle');
  const icon = await tree.locator('[data-path="/workspace/demo/docs/README.md"] .project-tree__icon').boundingBox();
  const after = await marker.boundingBox();
  expect(Math.abs(after.y + 7 - icon.y - icon.height / 2)).toBeLessThan(1);
  expect(errors).toEqual([]);
});

for (const mode of ['project', 'files']) {
  test(`${mode} mode slides one persistent marker between files in the same folder`, async ({ page }) => {
    await page.goto('/tests/fixtures/project-explorer.html');
    if (mode === 'files') await page.getByRole('button', { name: 'Toggle mode' }).click();
    const list = page.getByRole(mode === 'files' ? 'list' : 'tree');
    await expect(list.locator('[data-path="/workspace/demo/note6.md"]')).toBeVisible();
    const marker = list.locator('.file-tree__current-indicator'), handle = await marker.elementHandle();
    await switchFile(page, '/workspace/demo/note6.md');
    await expect(marker).toHaveAttribute('data-motion', 'idle');
    const before = await marker.boundingBox();
    await switchFile(page, '/workspace/demo/note7.md');
    await expect(marker).toHaveAttribute('data-motion', 'slide');
    const halfway = await marker.evaluate((element) => {
      const effect = element.getAnimations()[0]; effect.pause(); effect.currentTime = Number(effect.effect.getTiming().duration) / 2;
      const box = element.getBoundingClientRect(); effect.play(); return { y: box.y, height: box.height };
    });
    expect(halfway.y).toBeGreaterThan(before.y); expect(halfway.y).toBeLessThan(before.y + 32);
    expect(halfway.height).toBe(14);
    await expect(marker).toHaveAttribute('data-motion', 'idle');
    expect(await handle.evaluate((element) => element.isConnected)).toBe(true);
    expect(await marker.count()).toBe(1);
  });
}

test('switching again during a cross-folder exit keeps contracting at the old folder', async ({ page }) => {
  await page.goto('/tests/fixtures/project-explorer.html');
  const tree = page.getByRole('tree'), marker = tree.locator('.file-tree__current-indicator');
  await tree.getByRole('treeitem', { name: 'src', exact: true }).click();
  await tree.getByRole('treeitem', { name: 'docs', exact: true }).click();
  await switchFile(page, '/workspace/demo/src/README.md');
  await expect(marker).toHaveAttribute('data-motion', 'idle');
  const before = await marker.boundingBox();
  await switchFile(page, '/workspace/demo/docs/README.md');
  await expect(marker).toHaveAttribute('data-motion', 'exit');
  await marker.evaluate((element) => {
    const effect = element.getAnimations()[0]; effect.pause();
    effect.currentTime = Number(effect.effect.getTiming().duration) / 2;
  });
  await switchFile(page, '/workspace/demo/docs/readme.txt');
  await expect(marker).toHaveAttribute('data-motion', 'exit');
  const exiting = await marker.boundingBox();
  expect(Math.abs(exiting.y + exiting.height / 2 - before.y - before.height / 2)).toBeLessThan(1);
  await expect(marker).toHaveAttribute('data-motion', 'idle');
  const icon = await tree.locator('[data-path="/workspace/demo/docs/readme.txt"] .project-tree__icon').boundingBox();
  const after = await marker.boundingBox();
  expect(Math.abs(after.y + 7 - icon.y - icon.height / 2)).toBeLessThan(1);
});
