import { chromium } from '@playwright/test';

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (err) => errors.push(err.message));
await page.goto('http://127.0.0.1:3300/', { waitUntil: 'load' });
await page.waitForTimeout(5000);
const frame = page.frameLocator('.demo-app-frame');

await frame.locator('body').evaluate(() => {
  const makeFile = (name, content) => ({
    kind: 'file',
    name,
    getFile: async () => ({ name, text: async () => content, size: content.length, lastModified: Date.now() }),
    createWritable: async () => ({ write: async () => {}, close: async () => {} }),
  });
  window.showDirectoryPicker = async () => ({
    kind: 'directory',
    name: 'demo-folder',
    entries: async function* () {
      yield ['README.md', makeFile('README.md', '# Hello')];
      yield [
        'notes',
        {
          kind: 'directory',
          name: 'notes',
          entries: async function* () {
            yield ['todo.md', makeFile('todo.md', '# Todo')];
          },
        },
      ];
    },
  });
});

await frame.locator('.moki-action').nth(2).click();
await page.waitForTimeout(2500);
const crumb = () => frame.locator('.file-tree__breadcrumb').textContent();
const root = await crumb();

await frame.locator('.file-tree').getByText('notes', { exact: true }).last().click();
await page.waitForTimeout(1500);
const inside = await crumb();

await frame.locator('.file-tree__nav-btn').nth(2).click();
await page.waitForTimeout(1500);
const afterUp = await crumb();

await frame.locator('.file-tree__breadcrumb').getByText('web:', { exact: false }).first().click();
await page.waitForTimeout(1200);
const afterRoot = await crumb();
const rootHint = await frame.locator('body').evaluate(() => document.body.innerText.includes('根目录'));

await page.screenshot({ path: 'site/nav-result.png', fullPage: false });
console.log({ root, inside, afterUp, afterRoot, rootHint, errors: [...new Set(errors)].slice(0, 3) });
await browser.close();
