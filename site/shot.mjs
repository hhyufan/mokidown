import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://127.0.0.1:1460/';
const out = process.argv[3] ?? 'site/preview.png';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1500);
// Scroll through the page once so every IntersectionObserver scene starts.
await page.evaluate(async () => {
  const step = 420;
  for (let y = 0; y < document.body.scrollHeight; y += step) {
    window.scrollTo(0, y);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  window.scrollTo(0, 0);
});
await page.waitForTimeout(4200);
await page.screenshot({ path: out, fullPage: true });
const live = page.locator('.demo-frame');
if (await live.count()) {
  await live.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await live.screenshot({ path: out.replace(/\.png$/, '-live.png') });
}
await browser.close();
console.log('ok', out);
