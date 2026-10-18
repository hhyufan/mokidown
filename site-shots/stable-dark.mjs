import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto('http://127.0.0.1:3300/', { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.setItem('mokidown-home-theme', 'dark'); document.documentElement.dataset.theme = 'dark'; });
await page.waitForTimeout(400);
await page.evaluate(() => {
  const hosts = [...document.querySelectorAll('.feature-block-host')];
  hosts[3]?.scrollIntoView({ block: 'start', behavior: 'instant' });
});
await page.waitForTimeout(5200);
const box = await page.evaluate(() => {
  const demo = document.querySelector('.scene-theme-demo');
  const r = demo?.getBoundingClientRect();
  return r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null;
});
await page.screenshot({ path: 'C:/Code/React/mokidown/site-shots/stable-dark.png' });
console.log(JSON.stringify({ box, stage: await page.evaluate(() => document.querySelector('.scene-theme-demo')?.getAttribute('data-theme-state')) }));
await browser.close();
