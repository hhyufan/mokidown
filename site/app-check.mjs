import { chromium } from '@playwright/test';

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`);
});
await page.goto(process.argv[2] ?? 'http://127.0.0.1:1421/', { waitUntil: 'load' });
await page.waitForTimeout(6000);
await page.screenshot({ path: 'site/app-browser.png', fullPage: false });
console.log(
  'dom:',
  await page.evaluate(() => ({
    app: Boolean(document.querySelector('.app, #root > *')),
    sidebar: Boolean(document.querySelector('.sidebar, .app-sidebar')),
    titlebar: Boolean(document.querySelector('.titlebar, .title-bar')),
    footer: Boolean(document.querySelector('.footer, .app-footer')),
    bodyClass: document.body.className,
    rootChildren: document.getElementById('root')?.children.length,
  })),
);
console.log('errors:', [...new Set(errors)].slice(0, 12));
await browser.close();
