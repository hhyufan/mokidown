import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:3300/', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

// First screen: writing demo should start typing.
const firstStart = await page.evaluate(() => ({
  writing: Boolean(document.querySelector('.scene-writing-demo')),
  complete: document.querySelector('.scene-writing-demo')?.getAttribute('data-complete'),
  textLen: document.querySelector('.scene-writing-demo')?.textContent.length || 0,
}));
await page.waitForTimeout(2500);
const firstAfter = await page.evaluate(() => ({
  textLen: document.querySelector('.scene-writing-demo')?.textContent.length || 0,
  complete: document.querySelector('.scene-writing-demo')?.getAttribute('data-complete'),
}));

// Move to the second screen: the first demo must unmount.
await page.evaluate(() => {
  const hosts = [...document.querySelectorAll('.feature-block-host')];
  hosts[1]?.scrollIntoView({ block: 'start', behavior: 'instant' });
});
await page.waitForTimeout(900);
const second = await page.evaluate(() => ({
  writing: Boolean(document.querySelector('.scene-writing-demo')),
  split: Boolean(document.querySelector('.scene-editor-split')),
  splitComplete: document.querySelector('.scene-editor-split')?.getAttribute('data-complete'),
}));

// Fourth screen: theme ripple should replay (loop).
await page.evaluate(() => {
  const hosts = [...document.querySelectorAll('.feature-block-host')];
  hosts[3]?.scrollIntoView({ block: 'start', behavior: 'instant' });
});
await page.waitForTimeout(1000);
const theme1 = await page.evaluate(() => Boolean(document.querySelector('.scene-theme-ripple')));
await page.waitForTimeout(3800);
const theme2 = await page.evaluate(() => Boolean(document.querySelector('.scene-theme-ripple')));

console.log(JSON.stringify({ firstStart, firstAfter, second, theme1, theme2 }, null, 2));
await browser.close();
