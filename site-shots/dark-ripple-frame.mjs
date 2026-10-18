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
let shot = false;
for (let i = 0; i < 40 && !shot; i += 1) {
  await page.waitForTimeout(100);
  const state = await page.evaluate(() => {
    const ripple = document.querySelector('.scene-theme-ripple');
    const frame = ripple?.querySelector('.scene-theme-frame');
    return ripple && frame ? { theme: frame.getAttribute('data-theme'), clip: getComputedStyle(ripple).clipPath } : null;
  });
  if (state?.theme === 'dark') {
    await page.screenshot({ path: 'C:/Code/React/mokidown/site-shots/dark-ripple-frame.png' });
    console.log(JSON.stringify(state));
    shot = true;
  }
}
if (!shot) console.log('no dark ripple captured');
await browser.close();
