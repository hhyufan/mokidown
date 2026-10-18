import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('https://www.miaogu.xyz/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.evaluate(() => {
  const hosts = [...document.querySelectorAll('.feature-block-host')];
  hosts[3]?.scrollIntoView({ block: 'start', behavior: 'instant' });
});
await page.waitForTimeout(1200);
const at11 = await page.evaluate(() => {
  const ripple = document.querySelector('.scene-theme-ripple');
  const demo = document.querySelector('.scene-theme-demo');
  const rect = ripple?.getBoundingClientRect();
  return {
    hasRipple: Boolean(ripple),
    rippleRect: rect ? { w: Math.round(rect.width), h: Math.round(rect.height), top: Math.round(rect.top) } : null,
    anim: ripple ? getComputedStyle(ripple).animationName : null,
    demoState: demo?.getAttribute('data-theme-state'),
    demoRect: demo ? { w: Math.round(demo.getBoundingClientRect().width), h: Math.round(demo.getBoundingClientRect().height) } : null,
  };
});
await page.screenshot({ path: 'C:/Code/React/mokidown/site-shots/live-ripple-1s.png' });
await page.waitForTimeout(2200);
const atEnd = await page.evaluate(() => {
  const demo = document.querySelector('.scene-theme-demo');
  return { hasRipple: Boolean(document.querySelector('.scene-theme-ripple')), demoState: demo?.getAttribute('data-theme-state'), complete: demo?.getAttribute('data-complete') };
});
console.log(JSON.stringify({ at11, atEnd }, null, 2));
await browser.close();
