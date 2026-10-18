import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:3300/', { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.setItem('mokidown-home-theme', 'dark'); document.documentElement.dataset.theme = 'dark'; });
await page.waitForTimeout(400);
await page.evaluate(() => {
  const hosts = [...document.querySelectorAll('.feature-block-host')];
  hosts[3]?.scrollIntoView({ block: 'start', behavior: 'instant' });
});
await page.waitForTimeout(1200);
const info = await page.evaluate(() => {
  const demo = document.querySelector('.scene-theme-demo');
  const frame = demo?.querySelector('.scene-theme-frame');
  const card = demo?.closest('.scene-surface');
  const cs = demo ? getComputedStyle(demo) : null;
  const fs = frame ? getComputedStyle(frame) : null;
  return {
    state: demo?.getAttribute('data-theme-state'),
    demoBorder: cs ? { color: cs.borderColor, width: cs.borderTopWidth, radius: cs.borderRadius, outline: cs.outlineColor } : null,
    frameBorder: fs ? { color: fs.borderColor, width: fs.borderTopWidth } : null,
    frameTheme: frame?.getAttribute('data-theme'),
    cardClass: card?.className,
    cardBorder: card ? getComputedStyle(card).borderColor : null,
  };
});
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: 'C:/Code/React/mokidown/site-shots/dark-frame-border.png' });
await browser.close();
