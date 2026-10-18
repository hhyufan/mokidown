import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:3300/', { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.setItem('mokidown-home-theme', 'dark'); document.documentElement.dataset.theme = 'dark'; });
await page.waitForTimeout(500);
await page.evaluate(() => {
  const hosts = [...document.querySelectorAll('.feature-block-host')];
  hosts[3]?.scrollIntoView({ block: 'start', behavior: 'instant' });
});
const samples = [];
for (let i = 0; i < 40; i += 1) {
  await page.waitForTimeout(200);
  const value = await page.evaluate(() => {
    const frame = document.querySelector('.scene-theme-frame');
    const ripple = document.querySelector('.scene-theme-ripple');
    const frameEl = ripple?.querySelector('.scene-theme-frame') || frame;
    return frameEl ? {
      theme: frameEl.getAttribute('data-theme'),
      surface: getComputedStyle(frameEl).backgroundColor,
      ripple: Boolean(ripple),
    } : null;
  });
  if (value && (samples.length === 0 || JSON.stringify(value) !== JSON.stringify(samples[samples.length - 1]))) samples.push(value);
}
console.log(JSON.stringify(samples.slice(0, 12), null, 2));
await browser.close();
