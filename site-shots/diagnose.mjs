import { chromium } from 'playwright';
import fs from 'node:fs';

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:3300/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const info = await page.evaluate(() => {
  const describe = (el) => ({
    tag: el.tagName,
    id: el.id || '',
    cls: String(el.className || '').slice(0, 70),
    w: el.clientWidth,
    sw: el.scrollWidth,
    h: el.clientHeight,
    sh: el.scrollHeight,
    overflowX: getComputedStyle(el).overflowX,
    overflowY: getComputedStyle(el).overflowY,
    position: getComputedStyle(el).position,
  });
  const all = [...document.querySelectorAll('body *')];
  return {
    viewport: { w: innerWidth, h: innerHeight },
    doc: {
      scrollingElement: document.scrollingElement?.tagName,
      scrollHeight: document.scrollingElement?.scrollHeight,
      bodyScrollHeight: document.body.scrollHeight,
      htmlOverflowX: getComputedStyle(document.documentElement).overflowX,
      htmlOverflowY: getComputedStyle(document.documentElement).overflowY,
      bodyOverflowX: getComputedStyle(document.body).overflowX,
      bodyOverflowY: getComputedStyle(document.body).overflowY,
      snap: getComputedStyle(document.documentElement).scrollSnapType,
      scrollbarWidth: innerWidth - document.documentElement.clientWidth,
    },
    horizontalOverflow: all.filter((el) => el.scrollWidth > el.clientWidth + 2).slice(0, 12).map(describe),
    nestedScrollers: all.filter((el) => {
      const cs = getComputedStyle(el);
      return el.scrollHeight > el.clientHeight + 4 && ['auto', 'scroll'].includes(cs.overflowY);
    }).slice(0, 12).map(describe),
    sections: [...document.querySelectorAll('main > section, main > div, body > header, body > section')].map((el) => ({
      tag: el.tagName,
      id: el.id || '',
      cls: String(el.className || '').slice(0, 50),
      top: Math.round(el.getBoundingClientRect().top + scrollY),
      h: Math.round(el.getBoundingClientRect().height),
      snapAlign: getComputedStyle(el).scrollSnapAlign,
    })),
  };
});
fs.writeFileSync('C:/Code/React/mokidown/site-shots/scroll-info.json', JSON.stringify(info, null, 2));
await page.screenshot({ path: 'C:/Code/React/mokidown/site-shots/home-top.png' });
await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.6));
await page.waitForTimeout(400);
await page.screenshot({ path: 'C:/Code/React/mokidown/site-shots/home-mid.png' });
console.log(JSON.stringify(info, null, 2).slice(0, 6000));
await browser.close();
