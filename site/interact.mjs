import { chromium } from '@playwright/test';

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (err) => console.log('[pageerror]', err.message));
await page.goto('http://127.0.0.1:3300/', { waitUntil: 'load' });
await page.waitForTimeout(3000);

const frame = page.locator('.demo-frame');
await page.locator('.segment button').nth(1).click();
await page.waitForTimeout(300);
await frame.screenshot({ path: 'site/tab-outline.png' });

await page.locator('.segment button').nth(2).click();
await page.waitForTimeout(300);
await frame.screenshot({ path: 'site/tab-recent.png' });

await page.locator('[data-tab-document="notes"]').click();
await page.waitForTimeout(1200);
await frame.screenshot({ path: 'site/tab-notes.png' });
console.log(
  'state:',
  await page.evaluate(() => ({
    activeTab: document.querySelector('.demo-tab.active')?.dataset.tabDocument,
    activeView: document.querySelector('.sidebar-view.active')?.dataset.sidebarView,
    outlineItems: document.querySelectorAll('#outline-list .outline-item').length,
    recentItems: document.querySelectorAll('.recent-item').length,
    heading: document.querySelector('.moki-live-pane h1')?.textContent,
  })),
);
await browser.close();
