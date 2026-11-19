import { expect, test } from '@playwright/test';
import path from 'node:path';

const bridge = path.resolve('src/utils/previewFrameBridge.js');

test('Windows preview synchronizes native bounds, navigation and overlays', async ({ page }) => {
  await page.goto('/tests/native-web-preview-harness.html');
  const viewport = page.locator('.web-page__native');
  await expect(viewport).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  const command = (name) => page.evaluate((suffix) => window.nativePreview.commands.findLast(
    (entry) => entry.command === `native_web_preview_${suffix}`,
  ), name);
  const emit = (event) => page.evaluate((data) => window.nativePreview.emit(data), event);
  const layout = () => command('layout');
  await expect.poll(async () => (await command('open'))?.bounds.visible).toBe(false);
  const { id } = await command('open');
  await emit({ type: 'contentReady', navigationId: 1 });
  await expect.poll(async () => (await layout())?.bounds.visible).toBe(true);
  await page.evaluate(() => window.nativePreview.enableWallpaper());
  await expect.poll(async () => (await layout())?.appearance).toEqual({ enabled: true, light: 46, dark: 76 });
  await expect(viewport).not.toHaveAttribute('data-native-wallpaper', '');
  const before = (await layout()).bounds.width;
  await page.evaluate(() => window.nativePreview.delayLayout());
  await page.setViewportSize({ width: 900, height: 700 });
  await expect.poll(async () => (await layout()).bounds.width).toBeLessThan(before);
  const x = (await layout()).bounds.x;
  await page.evaluate(() => {
    const style = document.documentElement.style;
    style.setProperty('--moki-background-size', '1200px 800px');
    style.setProperty('--moki-background-x', '0px');
    style.setProperty('--moki-background-y', '0px');
    document.querySelector('#root').style.marginLeft = '120px';
  });
  await expect.poll(async () => (await viewport.boundingBox()).x).toBeGreaterThan(x);
  expect((await layout()).bounds.x).toBe(x);
  await page.evaluate(() => window.nativePreview.finishLayout());
  await expect.poll(async () => {
    const { bounds } = await layout();
    return bounds.x > x && bounds.wallpaper?.x === -bounds.x;
  }).toBe(true);

  await page.evaluate(() => {
    const popup = document.createElement('div');
    popup.className = 'ant-modal-mask';
    popup.style.cssText = 'position: fixed; inset: 0';
    document.body.append(popup);
  });
  await expect.poll(async () => (await layout()).bounds.visible).toBe(false);
  await page.locator('.ant-modal-mask').evaluate((popup) => popup.remove());
  await expect.poll(async () => (await layout()).bounds.visible).toBe(true);

  await emit({ type: 'page', url: 'https://preview.example/next', icons: [] });
  await expect(page.locator('.preview-address input')).toHaveValue('https://preview.example/next');
  const shown = await layout();
  await page.evaluate(() => window.nativePreview.setActive(false));
  await expect(viewport).toBeHidden();
  await expect.poll(async () => (await command('hide'))?.activation).toBe(shown.activation + 1);
  expect((await command('hide')).id).toBe(id);
  expect(await command('close')).toBeUndefined();
  await page.evaluate(() => window.nativePreview.setActive(true));
  await expect(viewport).toBeVisible();
  await expect.poll(async () => (await layout())?.activation).toBe(shown.activation + 2);
  expect(await layout()).toMatchObject({ id, bounds: { visible: true } });
  expect(await page.evaluate(() => window.nativePreview.commands.filter(
    (entry) => entry.command === 'native_web_preview_open',
  ))).toHaveLength(1);
  await expect(page.locator('.preview-address input')).toHaveValue('https://preview.example/next');
  await emit({ type: 'popup', url: 'https://preview.example/external' });
  await expect.poll(() => page.evaluate(() => window.nativePreview.commands.findLast(
    (entry) => entry.command === 'open_external',
  )?.url)).toBe('https://preview.example/external');
  await page.evaluate(() => window.nativePreview.openInEditor(true));
  await emit({ type: 'popup', url: 'https://preview.example/editor-tab' });
  await expect.poll(() => page.evaluate(() => window.nativePreview.tabUrls())).toContain('https://preview.example/editor-tab');

  await emit({ type: 'navigation', success: false, status: 403, navigationId: 2 });
  await emit({ type: 'contentReady', navigationId: 2 });
  await expect(page.getByRole('alert')).toContainText('HTTP 403');
  await expect.poll(async () => (await layout()).bounds.visible).toBe(false);
  await page.evaluate(() => window.nativePreview.unmount());
  await expect.poll(async () => (await command('close'))?.id).toBe(id);
});

const content = `<style>
html,body{background:#fff;color:rgb(25,35,45)}
.card{background:rgb(245,240,235)}input,button,select{background:#eee;color:#123}
button:hover{background:rgb(100,150,200)}
html[data-theme="dark"]{color-scheme:dark}
html[data-theme="dark"],html[data-theme="dark"] body{background:#181818;color:#eee}
html[data-theme="dark"] .card{background:#222}
html[data-theme="dark"] input{background:#333;color:#eee}
@media (prefers-color-scheme:dark) {
  html.follow-system, html.follow-system body { background:#181818;color:#eee }
}
.notif, [role="dialog"], [role="dialog"] button{background:#fff;color:#123}
.search-overlay,.settings-overlay,.custom-backdrop{display:none;position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.35);backdrop-filter:blur(2px)}
.search-box,.settings-card,.custom-panel{margin:25px;width:260px;padding:16px;border-radius:10px;background:rgb(255,255,255,.55);box-shadow:0 6px 18px #0003}
html[data-theme="dark"] .settings-card{background:rgb(32,32,32,.5)}
</style><main class="card" style="background-image: none"><h1>Cross-origin preview</h1><input value="visible text"><button>Add</button><select><option>Option</option></select><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"></main>
<div class="notif">Notification</div><div role="dialog"><button>Dialog action</button></div>
<div class="search-overlay"><div class="search-box">Search results</div></div>
<div class="settings-overlay"><div class="settings-card">Settings</div></div>
<div class="custom-backdrop"><div class="custom-panel">Custom popup</div></div>`;

test('native page appearance follows the website theme and keeps its text and dialogs readable', async ({ page }) => {
  await page.route('https://preview.example/native', (route) => route.fulfill({ contentType: 'text/html', body: content }));
  await page.goto('https://preview.example/native');
  await page.evaluate(() => { window.__mokiNativePreview = true; });
  await page.addScriptTag({ path: bridge });
  await page.evaluate(() => window.__mokiSetNativePreview({ enabled: true, light: 46, dark: 76 }));

  const root = page.locator('html');
  await expect(root).toHaveCSS('background-color', 'color(srgb 1 1 1 / 0.46)');
  await expect(page.locator('input')).toHaveCSS('color', 'rgb(17, 34, 51)');
  await root.evaluate((html) => { html.dataset.theme = 'dark'; });
  await expect(root).toHaveCSS('background-color', 'color(srgb 0.0941176 0.0941176 0.0941176 / 0.76)');
  await expect(page.locator('input')).toHaveCSS('color', 'rgb(238, 238, 238)');
  await expect(page.getByRole('dialog')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.evaluate(() => window.__mokiSetNativePreview({ enabled: false }));
  await expect(root).toHaveCSS('background-color', 'rgb(24, 24, 24)');
});

async function readViewportPixel(page, viewport) {
  const rect = await viewport.boundingBox();
  const pixel = await page.screenshot({ clip: { x: Math.floor(rect.x + 5), y: Math.floor(rect.y + rect.height / 2), width: 1, height: 1 } });
  return page.evaluate(async (base64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
    const context = new OffscreenCanvas(1, 1).getContext('2d');
    context.drawImage(bitmap, 0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
  }, pixel.toString('base64'));
}

test('cross-origin pages and dynamic controls get translucent surfaces without fading text', async ({ page }) => {
  // Mirrors AddScriptToExecuteOnDocumentCreated: Playwright installs this in
  // child frames too, including the genuinely cross-origin fixture below.
  await page.addInitScript({ path: bridge });
  await page.route('https://preview.example/**', (route) => route.fulfill({ contentType: 'text/html', body: content }));
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 40000 });
  await page.evaluate(async () => {
    (await import('/src/store/useThemeStore.js')).default.getState().setTheme('light');
    const { saveBackgroundImage } = await import('/src/utils/backgroundImage.js');
    const wallpaper = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
      <rect width="640" height="480" fill="#2070d0"/><rect x="450" width="190" height="480" fill="#d07020"/>
    </svg>`;
    const backgroundImage = await saveBackgroundImage(new Blob([wallpaper], { type: 'image/svg+xml' }));
    const config = (await import('/src/store/useConfigStore.js')).default;
    config.setState({ backgroundEnabled: true, backgroundImage, backgroundTransparency: { light: 46, dark: 76 } });
    const store = (await import('/src/store/useEditorStore.js')).default;
    store.getState().openWebTab('https://preview.example/');
  });
  const preview = page.frameLocator('.web-page__frame');
  await expect(preview.locator('body')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(preview.locator('input')).toHaveCSS('background-color', 'color(srgb 0.933333 0.933333 0.933333 / 0.38)');
  await expect(preview.locator('input')).toHaveCSS('color', 'rgb(17, 34, 51)');
  await expect(preview.locator('img')).toHaveCSS('opacity', '1');
  await preview.locator('main').evaluate((main) => {
    const input = document.createElement('input'); input.id = 'dynamic'; main.append(input);
  });
  await expect(preview.locator('#dynamic')).toHaveCSS('background-color', 'color(srgb 0.933333 0.933333 0.933333 / 0.38)');
  await preview.getByRole('button', { name: 'Add' }).hover();
  await expect(preview.getByRole('button', { name: 'Add' })).toHaveCSS('background-color', 'color(srgb 0.392157 0.588235 0.784314 / 0.38)');
  const frame = page.locator('.web-page__frame');
  const viewport = page.locator('.web-page__viewport');
  await expect(viewport).toHaveAttribute('data-preview-theme', 'light');
  await expect(viewport).toHaveCSS('background-image', /blob:/);
  await expect(viewport).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  const isAligned = () => viewport.evaluate((element) => {
    const root = getComputedStyle(document.documentElement);
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const size = root.getPropertyValue('--moki-background-size');
    const x = parseFloat(root.getPropertyValue('--moki-background-x')) - rect.left;
    const y = parseFloat(root.getPropertyValue('--moki-background-y')) - rect.top;
    const [imageX, imageY] = style.backgroundPosition.split(',').at(-1).trim().split(' ').map(parseFloat);
    return size && style.backgroundSize.endsWith(size) && Math.abs(imageX - x) < 1 && Math.abs(imageY - y) < 1;
  });
  await expect.poll(isAligned).toBe(true);
  const lightPixel = await readViewportPixel(page, viewport);
  expect(lightPixel[2]).toBeGreaterThan(lightPixel[0]);

  await page.evaluate(async () => (await import('/src/store/useThemeStore.js')).default.getState().setTheme('dark'));
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await expect(frame).toHaveCSS('color-scheme', 'light');
  await expect(viewport).toHaveAttribute('data-preview-theme', 'light');
  await expect(viewport).toHaveCSS('--moki-preview-wash', '46%');
  await expect(preview.locator('html')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(preview.locator('input').first()).toHaveCSS('background-color', 'color(srgb 0.933333 0.933333 0.933333 / 0.38)');
  await expect(preview.locator('input').first()).toHaveCSS('color', 'rgb(17, 34, 51)');
  await expect(preview.locator('.notif')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(preview.getByRole('button', { name: 'Dialog action' })).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(preview.getByRole('button', { name: 'Add' })).toHaveCSS('background-color', 'color(srgb 0.392157 0.588235 0.784314 / 0.38)');
  expect(await readViewportPixel(page, viewport)).toEqual(lightPixel);
  for (const [backdrop, panel] of [['.search-overlay', '.search-box'], ['.custom-backdrop', '.custom-panel']]) {
    await preview.locator(backdrop).evaluate((element) => { element.style.display = 'block'; });
    await expect(preview.locator(panel)).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await preview.locator(backdrop).evaluate((element) => { element.style.display = ''; });
  }
  await expect(preview.locator('.search-overlay')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.35)');
  await preview.locator('html').evaluate((html) => { html.dataset.theme = 'dark'; });
  await expect(frame).toHaveCSS('color-scheme', 'dark');
  await expect(viewport).toHaveAttribute('data-preview-theme', 'dark');
  await expect(viewport).toHaveCSS('--moki-preview-wash', '76%');
  await expect(viewport).toHaveCSS('background-color', 'rgb(24, 24, 24)');
  await expect(preview.locator('html')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(preview.locator('input').first()).toHaveCSS('background-color', 'color(srgb 0.2 0.2 0.2 / 0.38)');
  await expect(preview.locator('input').first()).toHaveCSS('color', 'rgb(238, 238, 238)');
  await preview.locator('.settings-overlay').evaluate((element) => { element.style.display = 'block'; });
  await expect(preview.locator('.settings-card')).toHaveCSS('background-color', 'rgb(28, 28, 28)');
  await preview.locator('.settings-overlay').evaluate((element) => { element.style.display = ''; });
  const darkPixel = await readViewportPixel(page, viewport);
  expect(darkPixel[0]).toBeLessThan(lightPixel[0] - 60);
  expect(darkPixel[2]).toBeGreaterThan(darkPixel[0]);
  await page.setViewportSize({ width: 1190, height: 760 });
  await expect.poll(isAligned).toBe(true);
  expect(await preview.locator('main').getAttribute('style')).toBe('background-image: none');
  await preview.locator('html').evaluate((html) => { delete html.dataset.theme; html.classList.add('follow-system'); });
  await expect(frame).toHaveCSS('color-scheme', 'light');
  await expect(viewport).toHaveAttribute('data-preview-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(viewport).toHaveAttribute('data-preview-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(viewport).toHaveAttribute('data-preview-theme', 'light');
  await page.evaluate(async () => (await import('/src/store/useConfigStore.js')).default.setState({ backgroundEnabled: false }));
  await expect(preview.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(preview.locator('input').first()).toHaveCSS('background-color', 'rgb(238, 238, 238)');
});

test('opening links reuses the second pane of an existing HTML split', async ({ page }) => {
  await page.route('https://preview.example/**', (route) => route.fulfill({ contentType: 'text/html', body: content }));
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 40000 });
  await page.evaluate(async () => {
    const store = (await import('/src/store/useEditorStore.js')).default;
    store.getState().openFile({ path: '/site/index.html', name: 'index.html', content: '<h1>Local preview</h1>' });
    store.getState().setViewMode('split');
  });
  await expect(page.locator('.html-preview__frame')).toBeVisible();
  await page.evaluate(async () => (await import('/src/store/useEditorStore.js')).default.getState().openWebSplit('https://preview.example/first'));
  await expect(page.locator('.html-preview__frame')).toBeHidden();
  await expect(page.locator('.editor-content__split-divider:visible')).toHaveCount(1);
  const source = await page.locator('.editor-content__editor').boundingBox();
  const target = await page.locator('.web-page').boundingBox();
  expect(target.x).toBeGreaterThan(source.x + source.width - 1);
  expect(Math.abs(target.y - source.y)).toBeLessThan(2);
  await page.evaluate(async () => (await import('/src/store/useEditorStore.js')).default.getState().openWebSplit('https://preview.example/second'));
  await expect(page.locator('.web-page__frame')).toHaveCount(1);
  await expect(page.locator('.web-page__frame')).toHaveAttribute('src', 'https://preview.example/second');
  await page.evaluate(async () => (await import('/src/store/useEditorStore.js')).default.getState().closeWebSplit());
  await expect(page.locator('.web-page__frame')).toHaveCount(0);
  await expect(page.locator('.html-preview__frame')).toBeVisible();
});

test('breadcrumb fades affect only clipped content while scrolling', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 40000 });
  await page.evaluate(async () => {
    const { default: files } = await import('/src/store/useFileStore.js');
    const { default: editors } = await import('/src/store/useEditorStore.js');
    const currentDir = `/tmp/${'workspace-'.repeat(22)}`;
    files.setState({ currentDir, explorerMode: 'files' });
    editors.getState().openFile({ path: `${currentDir}/notes.txt`, name: 'notes.txt', content: 'notes' });
  });

  for (const selector of ['.file-tree__breadcrumb-scroll', '.footer__breadcrumb-path']) {
    const scroll = page.locator(selector);
    await expect.poll(() => scroll.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeGreaterThan(50);
    await scroll.evaluate((element) => { element.scrollLeft = 0; });
    await expect(scroll).toHaveCSS('mask-image', /linear-gradient/);
    await scroll.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    await expect(scroll).toHaveCSS('mask-image', 'none');
  }
  for (const selector of ['.file-tree__breadcrumb-scroll-wrap', '.footer__breadcrumb']) {
    expect(await page.locator(selector).evaluate((element) => getComputedStyle(element, '::after').content)).toBe('none');
  }
});

test('preview navigation can open editor tabs and uses the page declared CDN icon', async ({ page }) => {
  await page.addInitScript({ path: bridge });
  await page.route('https://icons.example/**', (route) => {
    if (route.request().url().endsWith('/missing.ico')) return route.fulfill({ status: 404 });
    return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7" fill="white"/></svg>' });
  });
  await page.route('https://navigate.example/**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/favicon.ico') return route.fulfill({ status: 404 });
    return route.fulfill({ contentType: 'text/html', body: `<html><head>
      <link rel="icon" href="https://icons.example/missing.ico">
      <link rel="icon" href="//icons.example/declared.svg">
      </head><body><h1>Preview ${pathname}</h1><input aria-label="Draft">
      <a href="/same-pane">Same pane</a>
      <a href="/new-tab" target="_blank" rel="noopener">New editor tab</a>
      <button onclick="window.open('/script-tab', '_blank')">Script popup</button>
      <button onclick="history.pushState({}, '', '/spa-route')">SPA route</button>
      </body></html>` });
  });
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 40000 });
  await page.evaluate(async () => {
    const config = (await import('/src/store/useConfigStore.js')).default;
    config.setState({ openLinksInEditor: true, backgroundEnabled: false });
    (await import('/src/store/useEditorStore.js')).default.getState().openWebTab('https://navigate.example/');
  });
  const web = page.locator('.web-page:visible').frameLocator('iframe');
  const breadcrumb = page.locator('.footer__breadcrumb-segment--web');
  const icon = page.locator('.tabbar__tab--active .tabbar__tab-favicon');
  await expect(icon).toHaveAttribute('src', 'https://icons.example/declared.svg');
  await expect.poll(() => icon.evaluate((image) => image.naturalWidth)).toBe(16);
  const marker = await icon.evaluate((image) => {
    const style = getComputedStyle(image.parentElement, '::after');
    const resolved = document.createElement('span');
    resolved.style.backgroundColor = 'color-mix(in srgb, var(--accent) 78%, transparent)';
    image.parentElement.append(resolved);
    const accent = getComputedStyle(resolved).backgroundColor;
    resolved.remove();
    return { belowIcon: parseFloat(style.insetBlockStart) > image.height, blue: style.backgroundColor === accent };
  });
  expect(marker).toEqual({ belowIcon: true, blue: true });
  const outlines = await icon.evaluate((image) => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute('data-theme');
    root.dataset.theme = 'light';
    const light = getComputedStyle(image).filter;
    root.dataset.theme = 'dark';
    const dark = getComputedStyle(image).filter;
    if (previousTheme === null) root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', previousTheme);
    return { light, dark };
  });
  expect(outlines.light).toContain('drop-shadow');
  expect(outlines.dark).toContain('drop-shadow');
  expect(outlines.light).not.toBe(outlines.dark);
  await web.getByRole('link', { name: 'Same pane' }).click();
  await expect(web.getByRole('heading')).toHaveText('Preview /same-pane');
  await expect(breadcrumb).toHaveText('https://navigate.example/same-pane');
  await web.getByRole('button', { name: 'SPA route' }).click();
  await expect.poll(() => web.locator('html').evaluate(() => location.pathname)).toBe('/spa-route');
  await expect(breadcrumb).toHaveText('https://navigate.example/spa-route');
  await web.getByRole('textbox', { name: 'Draft' }).fill('Keep my draft');
  const originalTab = await page.locator('.tabbar__tab--active[data-web-tab]').getAttribute('data-tab-id');
  await web.getByRole('link', { name: 'New editor tab' }).click();
  await expect(breadcrumb).toHaveText('https://navigate.example/new-tab');
  await expect(web.getByRole('heading')).toHaveText('Preview /new-tab');
  await expect(icon).toHaveAttribute('src', 'https://icons.example/declared.svg');
  await page.evaluate(async () => (await import('/src/store/useEditorStore.js')).default.getState().createUntitledTab());
  await expect(page.locator('.web-page:visible')).toHaveCount(0);
  await page.locator(`[data-tab-id="${originalTab}"]`).click();
  await expect(breadcrumb).toHaveText('https://navigate.example/spa-route');
  await expect(web.getByRole('textbox', { name: 'Draft' })).toHaveValue('Keep my draft');
  await web.getByRole('button', { name: 'Script popup' }).click();
  await expect(breadcrumb).toHaveText('https://navigate.example/script-tab');
  expect(page.context().pages()).toHaveLength(1);
});

test('a local preview moves between split and tab and copies the address field', async ({ page }) => {
  await page.addInitScript(() => {
    if (window !== window.top) return;
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (value) => { window.copiedAddress = value; } },
    });
  });
  let requests = 0;
  await page.route(/^http:\/\/(localhost|127\.0\.0\.1):5173\//, (route) => {
    requests += 1;
    return route.fulfill({ contentType: 'text/html', body: content });
  });
  await page.goto('/');
  await expect(page.locator('.editor-content__welcome')).toBeVisible({ timeout: 40000 });
  const url = 'http://localhost:5173/docs?view=full#header';
  await page.evaluate(async (url) => (await import('/src/store/useEditorStore.js')).default.getState().openWebSplit(url), url);

  const web = page.locator('.web-page');
  const input = web.getByRole('textbox');
  await expect(input).toHaveValue(url);
  await expect(web.locator('.preview-address')).toHaveCSS('border-radius', '999px');
  await expect(web.frameLocator('iframe').getByRole('heading')).toBeVisible();
  const initialRequests = requests;
  await web.locator('.preview-address__button--refresh').click();
  await expect.poll(() => requests).toBe(initialRequests + 1);

  const draft = 'http://localhost:5173/typed';
  await input.fill(draft);
  await web.locator('.preview-address__button--copy').click();
  expect(await page.evaluate(() => window.copiedAddress)).toBe(draft);
  await input.press('Escape');

  const divider = page.locator('.editor-content__split-divider');
  const breadcrumb = page.locator('.footer__breadcrumb-segment--web');
  await web.locator('.preview-address__button--move').click();
  await expect(divider).toHaveCount(0);
  await expect(breadcrumb).toHaveText(url);
  await input.fill('/next');
  await input.press('Enter');
  await expect(breadcrumb).toHaveText('http://localhost:5173/next');
  await web.locator('.preview-address__button--move').click();
  await expect(divider).toBeVisible();
  await expect(breadcrumb).toHaveCount(0);
  await expect(web).toHaveCount(1);
  await expect(input).toHaveValue('http://localhost:5173/next');

  const alias = 'http://127.0.0.1:5173/other';
  await page.evaluate(async (url) => (await import('/src/store/useEditorStore.js')).default.getState().openWebTab(url), alias);
  await expect(divider).toHaveCount(0);
  await expect(breadcrumb).toHaveText(alias);
  await expect(web).toHaveCount(1);
  await web.locator('.preview-address__button--move').click();
  await web.locator('.preview-address__button--close').click();
  await expect(web).toHaveCount(0);
  await expect(page.locator('.editor-content__welcome')).toBeVisible();
});
test('terminal links keep the context menu and support all left-click modifiers', async ({ page }) => {
  await page.goto('/tests/terminal-harness.html');
  const terminal = page.locator('#terminal-panel');
  await expect(terminal.getByRole('status')).toHaveText('Local terminal');
  await page.evaluate(() => window.terminalTrial.emit('\r\nhttp://localhost:5173/test\r\n'));
  const row = terminal.locator('.xterm-rows > div').filter({ hasText: 'http://localhost:5173/test' });
  await expect(row).toBeVisible();
  const rect = await row.boundingBox();
  const point = [rect.x + 4, rect.y + rect.height / 2];
  await page.mouse.move(...point);
  await expect(terminal.locator('.xterm')).toHaveClass(/xterm-cursor-pointer/);
  await page.mouse.click(...point, { button: 'right' });
  await expect(page.getByRole('menuitem')).toHaveCount(5);
  await page.keyboard.press('Escape');
  for (const [keys, active, split] of [[['Control'], false, false], [['Control', 'Shift'], true, false], [['Control', 'Alt'], true, true]]) {
    await page.mouse.move(...point);
    for (const key of keys) await page.keyboard.down(key);
    await page.mouse.click(...point);
    for (const key of keys.toReversed()) await page.keyboard.up(key);
    await expect.poll(() => page.evaluate(async () => {
      const state = (await import('/src/store/useEditorStore.js')).default.getState();
      return { active: state.activeTabId.startsWith('web:'), split: Boolean(state.webSplitUrl) };
    })).toEqual({ active, split });
  }
  expect(await page.evaluate(() => window.terminalTrial.commands.some(({ command }) => command === 'open_external'))).toBe(false);
});
