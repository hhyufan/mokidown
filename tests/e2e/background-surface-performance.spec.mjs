import { test, expect } from '@playwright/test';

test('background geometry ignores editor scroll and coalesces viewport scroll without observer feedback', async ({ page }) => {
  await page.goto('/tests/background-harness.html');
  await page.waitForFunction(() => window.trial);
  await page.evaluate(() => { window.trial.apply({ theme: 'dark', background: true }); window.trial.showContextMenu(); });
  await expect(page.locator('.monaco-context-menu')).toBeVisible();
  await expect.poll(() => page.locator('.monaco-context-menu').evaluate((el) => el.style.getPropertyValue('--moki-popup-x'))).not.toBe('');

  const wallpaper = () => page.locator('.app').evaluate((app) => {
    const layer = getComputedStyle(app, '::before');
    return {
      width: Number.parseFloat(layer.width), height: Number.parseFloat(layer.height),
      scale: new DOMMatrixReadOnly(layer.transform).a,
    };
  });
  await expect.poll(async () => (await wallpaper()).width).toBe(600);
  for (const [width, height] of [[900, 620], [1280, 530], [800, 660]]) {
    await page.setViewportSize({ width, height });
    await expect.poll(async () => {
      const layer = await wallpaper();
      return layer.width === 600 && layer.height === 300
        && Math.abs(layer.scale - Math.max(width / 600, height / 300)) < 0.001;
    }).toBe(true);
  }

  const measurements = await page.evaluate(async () => {
    const app = document.querySelector('.app');
    const popup = document.querySelector('.monaco-context-menu');
    const reads = { app: 0, popup: 0 };
    const appRect = app.getBoundingClientRect.bind(app);
    const popupRect = popup.getBoundingClientRect.bind(popup);
    app.getBoundingClientRect = () => { reads.app += 1; return appRect(); };
    popup.getBoundingClientRect = () => { reads.popup += 1; return popupRect(); };
    const frame = () => new Promise(requestAnimationFrame);
    try {
      await frame(); await frame();
      reads.app = 0; reads.popup = 0;
      for (let i = 0; i < 20; i += 1) document.getElementById('editor').dispatchEvent(new Event('scroll'));
      await frame(); await frame();
      const editorScroll = { ...reads };
      reads.app = 0; reads.popup = 0;
      for (let i = 0; i < 20; i += 1) document.dispatchEvent(new Event('scroll'));
      await frame(); await frame();
      const viewportScroll = { ...reads };
      reads.app = 0; reads.popup = 0;
      popup.style.left = '410px';
      await frame(); await frame();
      return { editorScroll, viewportScroll, popupMove: { ...reads }, x: popup.style.getPropertyValue('--moki-popup-x') };
    } finally {
      delete app.getBoundingClientRect; delete popup.getBoundingClientRect;
    }
  });
  expect(measurements.editorScroll).toEqual({ app: 0, popup: 0 });
  expect(measurements.viewportScroll).toEqual({ app: 1, popup: 1 });
  expect(measurements.popupMove).toEqual({ app: 0, popup: 1 });
  expect(measurements.x).toBe('410px');
});
