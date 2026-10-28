import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark']) {
  test(`all five website scenes use current installer design (${theme})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    const blocks = page.locator('.feature-block');
    await expect(blocks).toHaveCount(5);
    for (let index = 0; index < 5; index++) {
      const block = blocks.nth(index);
      await block.scrollIntoViewIfNeeded();
      await expect(block).toHaveClass(/is-inview/);
      await expect(block.locator('.scene-surface').first()).toBeVisible();
      if (index === 0 || index === 3) {
        const quote = block.locator('blockquote').first();
        await expect(quote).toBeVisible();
        await expect(quote.locator('p').first()).toHaveCSS('margin-top', '0px');
        await expect(quote.locator('p').last()).toHaveCSS('margin-bottom', '0px');
      }
      if (index === 4) {
        const nav = block.locator('.scene-knowledge-nav');
        await expect(block.locator('.scene-knowledge-code .token.keyword').first()).toHaveText('const');
        await nav.locator('.moki-tree__node--linked .moki-tree__title').nth(1).click();
        await expect(block.locator('.scene-knowledge-code.is-target')).toContainText('console.log');
        const delta = await nav.evaluate(el => {
          const active = el.querySelector('.sidebar__tab--active').getBoundingClientRect();
          const slider = el.querySelector('.sidebar__tab-slider').getBoundingClientRect();
          return Math.abs(active.left - slider.left) + Math.abs(active.width - slider.width);
        });
        expect(delta).toBeLessThan(2);
        await expect(block.locator('.scene-knowledge-editor')).toHaveCount(0);
      }
      await block.locator('.feature-block__frame').screenshot({ path: `.cache/site-features/${theme}-${index + 1}.png` });
    }
  });
}

test('website knowledge tree replays its code navigation', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  const tree = page.locator('[data-moki-feature-block="4"]');
  await tree.scrollIntoViewIfNeeded();
  await expect(tree.locator('.scene-knowledge-preview')).toBeVisible();
  await page.clock.fastForward(1800);
  await expect(tree.locator('.scene-knowledge-code.is-target')).toContainText('const message');
  await page.clock.fastForward(6200);
  await expect(tree.locator('.scene-knowledge-code.is-target')).toContainText('notes.push');
  await page.clock.fastForward(7800);
  await expect(tree.locator('.scene-knowledge-code.is-target')).toContainText('const message');
});
