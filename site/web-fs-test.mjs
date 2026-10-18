import { chromium } from '@playwright/test';

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`);
});
await page.goto('http://127.0.0.1:3300/', { waitUntil: 'load' });
await page.waitForTimeout(4500);
const frame = page.frameLocator('.demo-app-frame');
await frame.locator('.moki-action').first().click();
await page.waitForTimeout(1200);
await page.screenshot({ path: 'site/web-new-doc.png', fullPage: false });
const info = await frame.locator('body').evaluate(() => ({
  hint: document.querySelector('#__moki_web_hint__')?.textContent ?? null,
  tabbar: document.querySelector('.tabbar, [class*="tab-bar"], [class*="tabbar"]')?.textContent?.trim().slice(0, 120) ?? null,
  editor: Boolean(document.querySelector('.milkdown, .monaco-editor, textarea')),
}));
console.log('info:', info);
console.log('errors:', [...new Set(errors)].slice(0, 8));
await browser.close();
