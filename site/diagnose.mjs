import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://127.0.0.1:3300/index-next.html';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (msg) => console.log(`[console:${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => console.log(`[pageerror] ${err.message}\n${err.stack ?? ''}`));
page.on('requestfailed', (req) => console.log(`[failed] ${req.url()} ${req.failure()?.errorText}`));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);
console.log(
  'mounts:',
  await page.evaluate(() => ({
    features: document.querySelectorAll('[data-moki-features]').length,
    featureChildren: document.querySelector('[data-moki-features]')?.children.length,
    live: document.querySelectorAll('[data-moki-live-editor]').length,
    liveChildren: document.querySelector('[data-moki-live-editor]')?.children.length,
    liveShell: document.querySelectorAll('.live-shell').length,
    featureBlocks: document.querySelectorAll('.feature-block').length,
    scripts: [...document.scripts].map((s) => s.src).filter(Boolean),
  })),
);
await browser.close();
