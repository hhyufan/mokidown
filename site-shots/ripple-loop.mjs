import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:3300/', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.evaluate(() => {
  const hosts = [...document.querySelectorAll('.feature-block-host')];
  hosts[3]?.scrollIntoView({ block: 'start', behavior: 'instant' });
});
const samples = [];
for (let i = 0; i < 56; i += 1) {
  await page.waitForTimeout(150);
  const on = await page.evaluate(() => Boolean(document.querySelector('.scene-theme-ripple')));
  if (on) samples.push(Math.round((i + 1) * 150));
}
console.log(JSON.stringify({ rippleSamples: samples, count: samples.length }, null, 2));
await browser.close();
