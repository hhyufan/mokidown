import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:3300/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const before = await page.evaluate(() => ({
  snap: getComputedStyle(document.documentElement).scrollSnapType,
  scrollbar: innerWidth - document.documentElement.clientWidth,
  docHeight: document.scrollingElement.scrollHeight,
  featureHosts: [...document.querySelectorAll('.feature-block-host')].map((el) => Math.round(el.getBoundingClientRect().height)),
  demoTop: Math.round(document.querySelector('#demo')?.getBoundingClientRect().top + scrollY || 0),
  scrollY: scrollY,
}));

// Click the nav TRY IT NOW link and record where it lands.
await page.click('a[data-scroll="#demo"]');
await page.waitForTimeout(1400);
const after = await page.evaluate(() => ({
  scrollY: Math.round(scrollY),
  demoTop: Math.round(document.querySelector('#demo')?.getBoundingClientRect().top + scrollY || 0),
  hash: location.hash,
}));

// Scroll through five screens, ensure no snap jumps and no nested scroller.
await page.evaluate(() => window.scrollTo(0, 2400));
await page.waitForTimeout(400);
const mid = await page.evaluate(() => ({
  scrollY: Math.round(scrollY),
  snap: getComputedStyle(document.documentElement).scrollSnapType,
  nested: [...document.querySelectorAll('body *')].filter((el) => {
    const cs = getComputedStyle(el);
    return el.scrollHeight > el.clientHeight + 4 && ['auto', 'scroll'].includes(cs.overflowY) && el.clientHeight > 120;
  }).slice(0, 5).map((el) => `${el.tagName}.${String(el.className).slice(0, 40)}`),
}));

await page.screenshot({ path: 'C:/Code/React/mokidown/site-shots/after-refactor-mid.png' });
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);
await page.screenshot({ path: 'C:/Code/React/mokidown/site-shots/after-refactor-top.png' });

console.log(JSON.stringify({ before, after, mid, landedOnDemo: Math.abs(after.scrollY - after.demoTop) < 100 }, null, 2));
await browser.close();
