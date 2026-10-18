import { chromium } from '@playwright/test';

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:3300/', { waitUntil: 'load' });
await page.waitForTimeout(4500);

const heroBefore = await page.locator('.hero-demo__title h1').textContent();
await page.locator('#language-toggle').click();
await page.waitForTimeout(500);
const heroAfter = await page.locator('.hero-demo__title h1').textContent();
const storyTitle = await page.locator('#product-story-title').textContent();

const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme);
const appThemeBefore = await page
  .frameLocator('.demo-app-frame')
  .locator('html')
  .evaluate((el) => el.dataset.theme);

await page.locator('#theme-toggle').click();
await page.waitForTimeout(1200);

const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme);
const appThemeAfter = await page
  .frameLocator('.demo-app-frame')
  .locator('html')
  .evaluate((el) => el.dataset.theme);

await page.screenshot({ path: 'site/locale-theme.png', fullPage: false });
console.log({ heroBefore, heroAfter, storyTitle, themeBefore, themeAfter, appThemeBefore, appThemeAfter });
await browser.close();
