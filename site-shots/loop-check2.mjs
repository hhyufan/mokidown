import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:3300/', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

async function state(label) {
  const value = await page.evaluate(() => ({
    scrollY: Math.round(scrollY),
    blocks: [...document.querySelectorAll('.feature-block')].map((el) => ({
      active: el.classList.contains('is-inview'),
      top: Math.round(el.getBoundingClientRect().top),
    })),
    writing: Boolean(document.querySelector('.scene-writing-demo')),
    themeDemo: Boolean(document.querySelector('.scene-theme-demo')),
    ripple: Boolean(document.querySelector('.scene-theme-ripple')),
  }));
  console.log(label, JSON.stringify(value));
}

await state('first');
await page.evaluate(() => {
  const hosts = [...document.querySelectorAll('.feature-block-host')];
  hosts[1]?.scrollIntoView({ block: 'start', behavior: 'instant' });
});
await page.waitForTimeout(900);
await state('second');
await page.evaluate(() => {
  const hosts = [...document.querySelectorAll('.feature-block-host')];
  hosts[3]?.scrollIntoView({ block: 'start', behavior: 'instant' });
});
await page.waitForTimeout(1000);
await state('fourth-1s');
await page.waitForTimeout(1200);
await state('fourth-2.2s');
await page.waitForTimeout(2600);
await state('fourth-4.8s');
await browser.close();
