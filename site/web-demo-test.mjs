import { chromium } from '@playwright/test';

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (err) => errors.push(err.message));
await page.goto('http://127.0.0.1:3300/', { waitUntil: 'load' });
await page.waitForTimeout(5000);
const frame = page.frameLocator('.demo-app-frame');

// Mock the browser directory picker so the demo's File System Access path can
// be exercised without a native dialog.
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
      yield ['README.md', makeFile('README.md', '# Hello\n\n**web demo** file')];
      yield ['notes', {
        kind: 'directory',
        name: 'notes',
        entries: async function* () {
          yield ['todo.md', makeFile('todo.md', '# Todo\n\n- [ ] one\n- [x] two')];
        },
      }];
    },
  });
});

await frame.locator('.moki-action').nth(2).click();
await page.waitForTimeout(2000);
const tree = await frame.locator('body').evaluate(() => ({
  items: [...document.querySelectorAll('.file-item')].map((n) => n.textContent.trim()).slice(0, 6),
  breadcrumb: document.querySelector('.file-breadcrumb')?.textContent?.trim() ?? null,
  notifications: [...document.querySelectorAll('[class*="notification"]')].map((n) => n.textContent.trim()).slice(0, 3),
}));

// Open the file from the tree.
const fileItem = frame.locator('.file-item', { hasText: 'README.md' }).first();
if (await fileItem.count()) {
  await fileItem.click();
  await page.waitForTimeout(1500);
}
const opened = await frame.locator('body').evaluate(() => ({
  tabs: document.querySelector('.tabbar')?.textContent?.trim().slice(0, 80) ?? null,
  heading: document.querySelector('.milkdown h1, .milkdown-editor h1, [contenteditable] h1')?.textContent ?? null,
}));
await page.screenshot({ path: 'site/web-demo-folder.png', fullPage: false });
console.log({ tree, opened, errors: [...new Set(errors)].slice(0, 5) });
await browser.close();
