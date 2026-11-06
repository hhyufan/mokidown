import { expect, test } from '@playwright/test';

test('ten million files remain scrollable at full row precision with bounded DOM', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/tests/fixtures/virtual-files.html');
  const list = page.getByRole('list');
  await expect(page.locator('[data-index="0"]')).toBeVisible();
  await list.focus();
  await page.keyboard.press('End');
  await expect(page.locator('[data-index="9999999"]')).toBeVisible();
  expect(await page.getByRole('listitem').count()).toBeLessThan(80);

  const size = await list.evaluate((node) => ({ height: node.scrollHeight, viewport: node.clientHeight }));
  expect(size.height).toBe(1_000_000);
  await list.evaluate((node) => { node.scrollTop = (node.scrollHeight - node.clientHeight) / 2; });
  await expect(page.locator('[data-index="5000000"]')).toBeVisible();

  await page.keyboard.press('Home');
  await list.hover();
  await page.mouse.wheel(0, 640);
  await expect(page.locator('[data-index="20"]')).toBeVisible();
  await expect(page.locator('[data-index="0"]')).toHaveCount(0);
  expect(await page.getByRole('listitem').count()).toBeLessThan(80);
  expect(errors).toEqual([]);
});

test('fast bursts and reversals prioritize the final viewport under delayed paged IO', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/tests/fixtures/virtual-files.html?paged=1&latency=80');
  await expect(page.locator('[data-index="0"]')).toHaveAttribute('data-loaded', 'true');
  await page.waitForFunction(() => window.virtualFileStress.active === 0);
  const burst = await page.evaluate(async () => {
    const list = document.querySelector('[role=list]');
    const before = window.virtualFileStress.ranges;
    for (let i = 0; i < 100; i += 1) list.dispatchEvent(new WheelEvent('wheel', { deltaY: 640, bubbles: true, cancelable: true }));
    const immediate = window.virtualFileStress.ranges - before;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { immediate, frames: window.virtualFileStress.ranges - before, tier: list.dataset.scrolling,
      rows: list.querySelectorAll('[role=listitem]').length };
  });
  expect(burst.immediate).toBe(0);
  expect(burst.frames).toBe(1);
  expect(burst.tier).toBe('fast');
  expect(burst.rows).toBeLessThan(80);

  const finalIndex = await page.evaluate(async () => {
    const list = document.querySelector('[role=list]');
    let offset = 64_000;
    for (let frame = 0; frame < 60; frame += 1) {
      const delta = frame < 40 ? 8000 : -6400;
      offset += delta;
      list.dispatchEvent(new WheelEvent('wheel', { deltaY: delta, bubbles: true, cancelable: true }));
      await new Promise(requestAnimationFrame);
    }
    return offset / 32;
  });
  const finalRow = page.locator(`[data-index="${finalIndex}"]`);
  await expect(finalRow).toBeVisible();
  await expect(finalRow).toHaveAttribute('data-loaded', 'true');
  await expect(finalRow).toHaveAttribute('data-details', 'ready');
  await expect(finalRow).toContainText(`note${finalIndex}.md`);
  const metrics = await page.evaluate(() => window.virtualFileStress);
  expect(metrics.maxActive).toBeLessThanOrEqual(2);
  expect(metrics.maxCachePages).toBeLessThanOrEqual(16);
  expect(await page.getByRole('listitem').count()).toBeLessThan(40);
  expect(errors).toEqual([]);
});

test('large native scrollbar jumps commit without a loading surface', async ({ page }) => {
  await page.goto('/tests/fixtures/virtual-files.html?paged=1&latency=250');
  await expect(page.locator('[data-index="0"]')).toHaveAttribute('data-loaded', 'true');
  const samples = await page.evaluate(async () => {
    const list = document.querySelector('[role=list]');
    const viewport = document.querySelector('.file-tree__viewport');
    const samples = [];
    for (const fraction of [0.95, 0.05, 0.75, 0.15, 1]) {
      list.scrollTop = fraction * (list.scrollHeight - list.clientHeight);
      list.dispatchEvent(new Event('scroll'));
      const box = viewport.getBoundingClientRect();
      const parent = list.getBoundingClientRect();
      samples.push({ offset: Math.abs(box.top - parent.top), height: box.height,
        pending: viewport.getAttribute('data-pending'),
        guard: document.querySelector('.file-tree__loading-guard'), viewport: list.clientHeight });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    return samples;
  });
  for (const sample of samples) {
    expect(sample.offset).toBeLessThan(1);
    expect(sample.height).toBe(sample.viewport);
    expect(sample.pending).toBeNull();
    expect(sample.guard).toBeNull();
  }
  const last = page.locator('[data-index="9999999"]');
  await expect(last).toHaveAttribute('data-loaded', 'true');
  const [row, list] = await Promise.all([last.boundingBox(), page.getByRole('list').boundingBox()]);
  expect(row.y + row.height).toBeCloseTo(list.y + list.height, 0);
});
