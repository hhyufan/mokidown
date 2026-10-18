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
await page.waitForTimeout(1500);
const info = await page.evaluate(() => {
  const demo = document.querySelector('.scene-theme-demo');
  const frame = demo?.querySelector('.scene-theme-frame');
  const stage = demo?.closest('.scene-themes');
  const pick = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      cls: String(el.className).slice(0, 50),
      bg: cs.backgroundColor,
      bgImage: cs.backgroundImage?.slice(0, 60),
      border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
      outline: cs.outlineWidth + ' ' + cs.outlineStyle + ' ' + cs.outlineColor,
      shadow: cs.boxShadow?.slice(0, 80),
      radius: cs.borderRadius,
      overflow: cs.overflow,
    };
  };
  return { demo: pick(demo), frame: pick(frame), stage: pick(stage), parent: pick(demo?.parentElement) };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
