import { chromium } from '@playwright/test';

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (err) => errors.push(err.message));
await page.goto('http://127.0.0.1:3300/', { waitUntil: 'load' });
await page.waitForTimeout(5000);
const frame = page.frameLocator('.demo-app-frame');

const noticeText = () =>
  frame.locator('body').evaluate(() => {
    const nodes = [...document.querySelectorAll('[class*="notif"], [class*="Notification"], .ant-notification-notice')];
    return nodes.map((n) => n.textContent.trim()).filter(Boolean).slice(0, 4);
  });

// 1) Sidebar footer refresh = check updates
await frame.locator('.sidebar__footer-btn').nth(1).click();
await page.waitForTimeout(800);
const afterRefresh = await noticeText();

// 2) Settings -> check updates button
await frame.locator('.sidebar__footer-btn').nth(2).click();
await page.waitForTimeout(1200);
const settingsOpen = await frame.locator('body').evaluate(() => document.body.innerText.includes('检查更新'));
const checkBtn = frame.getByRole('button', { name: '检查更新' });
let afterSettingsCheck = null;
if (await checkBtn.count()) {
  await checkBtn.first().click();
  await page.waitForTimeout(800);
  afterSettingsCheck = await noticeText();
}
await page.keyboard.press('Escape');
await page.waitForTimeout(600);

// 3) Footer breadcrumb needs an open file; mock the file picker.
await frame.locator('body').evaluate(() => {
  const file = (name, content) => ({
    name,
    text: async () => content,
    size: content.length,
    lastModified: Date.now(),
  });
  const handle = { kind: 'file', name: 'README.md', getFile: async () => file('README.md', '# Hello') };
  window.showOpenFilePicker = async () => [handle];
});
await frame.locator('.moki-action').nth(1).click();
await page.waitForTimeout(2000);
const crumb = frame.locator('.footer__breadcrumb-segment').first();
let afterCrumb = null;
if (await crumb.count()) {
  await crumb.click();
  await page.waitForTimeout(800);
  afterCrumb = await noticeText();
}

await page.screenshot({ path: 'site/friendly-entries.png', fullPage: false });
console.log({ afterRefresh, settingsOpen, afterSettingsCheck, afterCrumb, errors: [...new Set(errors)].slice(0, 4) });
await browser.close();
