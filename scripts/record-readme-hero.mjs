/** Record real editor interactions in an isolated browser profile with sample notes.
 * MDE_SCREENSHOT_RUNTIME can point to a package directory providing sharp.
 * MDE_HERO_URL can reuse a running development server; otherwise port 1437 is used.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startLosslessVideo } from './hero-lossless-video.mjs';
import { authorHeroNote } from './hero-author-note.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(process.env.MDE_SCREENSHOT_RUNTIME
  ? path.join(process.env.MDE_SCREENSHOT_RUNTIME, 'package.json') : import.meta.url);
const sharp = require('sharp');
sharp.cache(false);
sharp.concurrency(2);
const output = path.join(root, 'screenshots', 'hero-demo.gif');
const recordingSize = { width: 1920, height: 1200 };
const fps = 50;
const ffmpeg = process.env.MDE_FFMPEG_PATH || require(path.join(root, '.cache', 'hero-tools', 'node_modules', 'ffmpeg-static'));
const { path: humanPath } = require(path.join(root, '.cache', 'hero-tools', 'node_modules', 'ghost-cursor')); 
const artifacts = path.join(root, '.cache', 'hero-recording');
await fs.mkdir(artifacts, { recursive: true });
const url = process.env.MDE_HERO_URL || 'http://127.0.0.1:1437';
let server;
let browser;
let context;
let recordingStartedAt;
let recorder;
const chapters = [];
const errors = [];
let stage = 'setup';

const tree = '我的知识工作台\n  自由书写\n    所见即所得\n    Markdown 与分屏预览\n  代码实践\n    运行 `ideas.join()` >javascript[1]\n    整理 `notebook` >javascript++\n  知识连接\n    阅读与积累\n';

try {
  if (!process.env.MDE_HERO_URL) {
    server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '1437', '--strictPort'],
      { cwd: root, windowsHide: true, stdio: 'ignore' });
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { ready = (await fetch(url)).ok; } catch { /* server is starting */ }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(ready, 'The isolated recording server must start');
  }
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN', deviceScaleFactor: 1.5 });
  const page = await context.newPage();
  // Screencasts ignore deviceScaleFactor alone. Request a high-density backing
  // viewport while retaining the same CSS layout and editor coordinates.
  const density = await context.newCDPSession(page);
  await density.send('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 800, deviceScaleFactor: 1.5, mobile: false,
    screenWidth: recordingSize.width, screenHeight: recordingSize.height,
    viewport: { x: 0, y: 0, width: 1280, height: 800, scale: 1.5 },
  });
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('mokidown-config', JSON.stringify({ state: { language: 'zh', autoSave: false,
      fontSize: 15, previewFontSize: 16, backgroundTransparency: { light: 85, dark: 85 } }, version: 0 }));
    localStorage.setItem('mokidown-theme', JSON.stringify({ state: { theme: 'light' }, version: 0 }));
    localStorage.setItem('mokidown-language', 'zh');
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('.sidebar').waitFor({ timeout: 60000 });
  // Preload the real renderers before the first recorded frame.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.evaluate(async () => Promise.all([
        import('/src/components/editor/MilkdownMarkdownEditor.jsx'),
        import('/src/components/editor/MonacoEditor.jsx'),
        import('/src/components/editor/TreeEditor.jsx'),
      ]));
      await page.waitForTimeout(1000);
      break;
    } catch (error) { if (attempt === 2) throw error; await page.waitForTimeout(1500); }
  }
  const notes = path.join(artifacts, 'notes');
  await fs.mkdir(notes, { recursive: true });
  await fs.writeFile(path.join(notes, '灵感笔记.md'), '');
  await fs.writeFile(path.join(notes, '灵感笔记.mgtree'), tree);
  await page.evaluate(async () => {
    const config = (await import('/src/store/useConfigStore.js')).default;
    const image = await fetch('/src/assets/characters/' + encodeURIComponent('昼夜双生的星光书页.png')).then(res => res.blob());
    const id = await (await import('/src/utils/backgroundImage.js')).saveBackgroundImage(image);
    config.getState().loadConfig({ language: 'zh', autoSave: false, fontSize: 15, previewFontSize: 16, backgroundImage: id,
      backgroundImageName: '昼夜双生的星光书页.png', backgroundEnabled: true,
      backgroundTransparency: { light: 85, dark: 85 } });
    await (await import('/src/i18n/index.js')).default.changeLanguage('zh');
    const store = (await import('/src/store/useEditorStore.js')).default;
    store.setState({ tabs: [], tabRenderList: [], activeTabId: null, viewMode: 'preview',
      sidebarView: 'explorer', sidebarVisible: true, sidebarWidth: 330 });
    (await import('/src/store/useThemeStore.js')).default.getState().setTheme('light');
  });
  await page.locator('.moki-action--primary').waitFor({ timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1600);
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--moki-background-opacity').trim()), '0.15');
  // Video captures the native blinking caret. The overlay only records the OS
  // pointer, which browser recordings omit, using the actual hit-test cursor.
  await page.evaluate(() => {
    const icons = {
      default: '<path d="M2 1v17l4-4 3 6 3-1-3-6h6z" fill="white" stroke="#26344b" stroke-width="1.3" stroke-linejoin="round"/>',
      text: '<path d="M6 2h7M9.5 2v18M6 20h7" stroke="white" stroke-width="3.8"/><path d="M6 2h7M9.5 2v18M6 20h7" stroke="#26344b" stroke-width="1.4"/>',
      pointer: '<path d="M6 11V3a1.5 1.5 0 0 1 3 0v6-1a1.5 1.5 0 0 1 3 0v1a1.5 1.5 0 0 1 3 0v1a1.5 1.5 0 0 1 3 0v5c0 4-2 6-6 6h-1c-2 0-3-1-4-3l-4-5c-1-2 1-3 2-2l1 1z" fill="white" stroke="#26344b" stroke-width="1.2" stroke-linejoin="round"/>',
      resize: '<path d="M1 11h18M1 11l4-4m-4 4 4 4m14-4-4-4m4 4-4 4M9 4v14m3-14v14" stroke="white" stroke-width="3.8"/><path d="M1 11h18M1 11l4-4m-4 4 4 4m14-4-4-4m4 4-4 4M9 4v14m3-14v14" stroke="#26344b" stroke-width="1.3"/>',
    };
    const cursor = document.createElement('div'); cursor.id = 'demo-cursor';
    cursor.style.cssText = 'position:fixed;left:0;top:0;transform:translate(-40px,-40px);width:20px;height:23px;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 1px 1px #0003)';
    document.body.append(cursor);
    window.demoPointerStats = { default: 0, text: 0, pointer: 0, resize: 0 };
    let current, position = { x: -40, y: -40 }, typingUntil = 0;
    const draw = () => {
      const target = document.elementFromPoint(position.x, position.y);
      const css = target ? getComputedStyle(target).cursor : 'default';
      const editable = target?.isContentEditable || target?.closest('input:not([type="checkbox"]),textarea');
      const kind = css.includes('resize') ? 'resize' : css === 'pointer' ? 'pointer' : css === 'text' || editable ? 'text' : 'default';
      cursor.style.transform = 'translate3d(' + (position.x - (kind === 'text' ? 10 : 2)) + 'px,' + (position.y - (kind === 'text' ? 11 : 1)) + 'px,0)';
      cursor.style.opacity = performance.now() < typingUntil ? '0' : '1';
      if (kind !== current) { cursor.innerHTML = '<svg viewBox="0 0 20 23">' + icons[kind] + '</svg>'; cursor.dataset.kind = current = kind; }
      window.demoPointerStats[kind]++;
      requestAnimationFrame(draw);
    };
    document.addEventListener('mousemove', event => { position = {x: event.clientX, y: event.clientY}; typingUntil = 0; }, true);
    document.addEventListener('beforeinput', () => { typingUntil = performance.now() + 650; }, true);
    requestAnimationFrame(draw);
  });
  const hold = ms => page.waitForTimeout(ms);
  // Playwright screenshots reset device metrics on cleanup and break the
  // custom high-density screencast. Save the current recording frame instead.
  const stageSnapshots = [];
  const snapshot = async name => {
    await sharp(recorder.currentFrame()).png().toFile(path.join(artifacts, name + '.png'));
    stageSnapshots.push(name);
  };
  const chapter = async name => { stage = name; chapters.push({ name, timeMs: Date.now() - recordingStartedAt }); console.log('Recording: ' + name); };
  let pointer = { x: 1150, y: 690 };
  let pointerMoving = false;
  await page.mouse.move(pointer.x, pointer.y);
  const glide = async (x, y) => {
    const curve = humanPath(pointer, { x, y }, { spreadOverride: 18, moveSpeed: 40 });
    const duration = Math.max(280, Math.min(650, Math.hypot(x - pointer.x, y - pointer.y) * 0.65));
    const samples = Math.ceil(duration / 16);
    const points = Array.from({ length: samples }, (_, index) => curve[Math.round(index * (curve.length - 1) / (samples - 1))]);
    const start = Date.now();
    pointerMoving = true;
    for (let index = 0; index < points.length; index++) {
      await page.mouse.move(points[index].x, points[index].y);
      await hold(Math.max(0, duration * (index + 1) / points.length - (Date.now() - start)));
    }
    pointer = { x, y };
    pointerMoving = false;
  };
  const moveTo = async (locator, options = {}) => {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox(); assert.ok(box);
    await glide(box.x + (options.position?.x ?? box.width / 2), box.y + (options.position?.y ?? box.height / 2));
  };
  const click = async (locator, options) => { await moveTo(locator, options); await hold(160); await locator.click(options); await hold(120); };
  const doubleClick = async locator => { await moveTo(locator); await hold(160); await locator.dblclick({ delay: 100 }); await hold(120); };
  const typeText = async (text, { pace = 'prose' } = {}) => {
    let index = 0;
    for (const char of text) {
      await page.keyboard.insertText(char);
      await hold(pace === 'code' ? 26 : /[，。·]/.test(char) ? 150 : [55, 80, 65, 95][index++ % 4]);
    }
  };
  // Only this recording session replaces the desktop-only execution boundary.
  // Button, editor content and result UI are unchanged; stdout comes from Node.
  await page.exposeFunction('__recordingExecuteJavaScript', source => new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(process.execPath, ['--input-type=module', '--eval', source],
      { cwd: notes, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timeout = setTimeout(() => child.kill(), 10000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', exitCode => { clearTimeout(timeout); resolve({ stdout, stderr, exitCode, elapsedMs: Date.now() - started }); });
  }));
  await page.evaluate(async () => {
    const { scriptRunner } = await import('/src/services/scriptRunner.js');
    const runs = (await import('/src/store/useCodeBlockRunStore.js')).default;
    scriptRunner.runBlock = async ({ key, language, source, fileName }) => {
      if (language !== 'javascript') throw new Error('The recording adapter only executes JavaScript');
      const runId = crypto.randomUUID();
      const receive = event => runs.getState().receive(key, { runId, ...event });
      runs.getState().prepare(key, { runId, language, source, fileName });
      receive({ kind: 'status', text: 'started' });
      const result = await window.__recordingExecuteJavaScript(source);
      if (result.stdout) receive({ kind: 'stdout', text: result.stdout });
      if (result.stderr) receive({ kind: 'stderr', text: result.stderr });
      receive({ kind: 'exit', exitCode: result.exitCode, elapsedMs: result.elapsedMs });
    };
  });
  const videoPath = path.join(artifacts, 'desktop-lossless.mkv');
  recorder = await startLosslessVideo(page, ffmpeg, videoPath, { ...recordingSize, fps, isMoving: () => pointerMoving });
  recordingStartedAt = Date.now();

  await authorHeroNote(page, { click, doubleClick, typeText, hold, chapter, snapshot });
  // Bind the authored sample to the recording workspace, then attach its tree.
  // All Markdown content comes from the UI interactions above.
  const authoredSource = await page.evaluate(async ({ notes, tree }) => {
    const store = (await import('/src/store/useEditorStore.js')).default;
    const { flushEditorBuffer, getBuffer } = await import('/src/utils/editorBuffer.js');
    const state = store.getState();
    flushEditorBuffer(state.activeTabId);
    const source = getBuffer(state.activeTabId);
    if (!source.includes('console.log(ideas.join') || !source.includes('写下灵感')) {
      throw new Error('The authored document must be captured before attaching its knowledge tree');
    }
    const mdPath = notes + '/灵感笔记.md';
    state.updateTabPath(state.activeTabId, mdPath, '灵感笔记.md');
    store.getState().openFile({ path: notes + '/灵感笔记.mgtree', name: '灵感笔记.mgtree', content: tree });
    store.getState().setActiveTab(mdPath);
    const files = (await import('/src/store/useFileStore.js')).default;
    files.getState().addRecentFile({ path: mdPath, name: '灵感笔记.md' });
    files.getState().addRecentFile({ path: notes + '/灵感笔记.mgtree', name: '灵感笔记.mgtree' });
    return source;
  }, { notes: notes.replace(/\\/g, '/'), tree });
  await fs.writeFile(path.join(notes, '灵感笔记.md'), authoredSource);
  await page.getByRole('tab', { name: '知识树', exact: true }).waitFor();
  await click(page.getByRole('tab', { name: '知识树', exact: true }));
  await page.locator('.sidebar .knowledge-tree').waitFor();

  await chapter('所见即所得 · 真实运行代码');
  await click(page.locator('.sidebar .knowledge-tree').getByRole('button', { name: '运行 ideas.join()', exact: true }));
  await hold(700);
  await click(page.getByRole('button', { name: '运行此代码块', exact: true }).first());
  await page.locator('.md-code-execution__result.is-success').first().waitFor({ timeout: 30000 });
  assert.match(await page.locator('.md-code-execution__output').first().innerText(), /记录 → 尝试 → 连接/);
  await hold(1800); await snapshot('01b-live-code-run');
  await chapter('Markdown 源码与分屏编辑');
  await click(page.locator('.tabbar__action-btn').filter({ has: page.locator('svg line[x1="12"][y1="3"]') }));
  await page.locator('.monaco-editor').first().waitFor();
  await click(page.locator('.monaco-editor .view-lines').first());
  await page.keyboard.press('Control+End'); await page.keyboard.press('Enter');
  await typeText('分屏中修改源码，右侧实时呈现。'); await hold(1100);
  await snapshot('02-split');
  await click(page.locator('.tabbar__action-btn--active').filter({ has: page.locator('svg line[x1="12"][y1="3"]') }));
  await click(page.getByRole('button', { name: /预览 \(Ctrl/ }));
  await page.locator('.milkdown-editor').waitFor(); await hold(800);

  await chapter('昼夜主题 · 透明度 85%');
  const theme = page.locator('.sidebar__footer-btn').filter({ has: page.locator('.theme-switch-icons') });
  await click(theme); await hold(1600);
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await snapshot('03-dark');

  await chapter('知识树原位编辑');
  await click(page.getByRole('tab', { name: '最近', exact: true }));
  await click(page.locator('.tabbar__tab').filter({ hasText: '灵感笔记.mgtree' }));
  const editor = page.locator('.editor-content .moki-tree');
  await editor.waitFor();
  await click(editor.getByRole('button', { name: '展开全部', exact: true }));
  await hold(700);
  await click(editor.getByRole('button', { name: '阅读与积累', exact: true }));
  const input = editor.getByRole('textbox', { name: '编辑节点' });
  await input.waitFor(); await page.keyboard.press('Control+a');
  await typeText('把灵感连接成自己的知识'); await page.keyboard.press('Enter');
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await hold(750);
  const codeNode = editor.getByRole('button', { name: '运行 ideas.join()', exact: true });
  await click(codeNode);
  await page.keyboard.press('End'); await typeText(' · 实践'); await page.keyboard.press('Enter');
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await hold(700); await snapshot('04-tree-edit');

  await chapter('配置代码跳转');
  await click(editor.getByRole('button', { name: '编辑代码跳转', exact: true }).first());
  await page.locator('.moki-tree__jump-form').waitFor();
  const language = page.locator('.moki-tree__jump-form').getByRole('combobox', { name: '代码语言' });
  await click(language); await page.keyboard.press('Control+a');
  await page.keyboard.type('javascript', { delay: 95 });
  await hold(300);
  await click(page.locator('.moki-tree__jump-form').getByText('下一个', { exact: true }));
  await hold(700); await snapshot('05-jump-settings');
  await click(page.locator('.moki-tree__jump-form').getByRole('button', { name: /应\s*用/ }));
  await hold(450);

  await chapter('知识树导航 · 代码块定位');
  await click(page.locator('.tabbar__tab').filter({ hasText: '灵感笔记.md' }));
  await page.locator('.milkdown-editor').waitFor();
  await click(page.getByRole('tab', { name: '知识树', exact: true }));
  const nav = page.locator('.sidebar .knowledge-tree');
  await click(nav.getByRole('button', { name: '运行 ideas.join() · 实践', exact: true }));
  await hold(1600);
  assert.equal(await page.locator('.knowledge-tree-target').count(), 1);
  await snapshot('06-code-jump-dark');
  await click(nav.getByRole('button', { name: '整理 notebook', exact: true }));
  await hold(1400);
  await click(theme); await hold(1200);
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await click(nav.getByRole('button', { name: '运行 ideas.join() · 实践', exact: true }));
  await hold(1100); await snapshot('07-code-jump-light');
  await chapter('自由调整侧栏');
  const resizer = page.locator('.sidebar__resizer');
  const rect = await resizer.boundingBox();
  await glide(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await hold(250); await page.mouse.down(); await glide(rect.x + 65, rect.y + rect.height / 2); await page.mouse.up();
  await hold(1000);
  await page.evaluate(() => {
    document.querySelector('.milkdown-editor')?.closest('.md-preview')?.scrollTo({ top: 0, behavior: 'smooth' });
  });
  await glide(1130, 690);
  await hold(1900); await snapshot('08-final');
  const durationMs = Date.now() - recordingStartedAt;
  const pointerStats = await page.evaluate(() => window.demoPointerStats);
  assert.ok(pointerStats.text > 0 && pointerStats.pointer > 0 && pointerStats.resize > 0);
  assert.equal(errors.length, 0, errors.join('\n'));
  const captured = await recorder.stop(); recorder = null;
  // Reject the large blank lower-right canvas produced by a scale reset.
  const fullFrameChecks = [];
  for (const name of stageSnapshots) {
    const image = sharp(path.join(artifacts, name + '.png'));
    const meta = await image.metadata();
    assert.equal(meta.width, recordingSize.width);
    assert.equal(meta.height, recordingSize.height);
    const texture = await image.extract({ left: 1344, top: 780, width: 384, height: 240 }).stats();
    const variation = Math.max(...texture.channels.slice(0, 3).map(channel => channel.stdev));
    assert.ok(variation > 1, `${name}: unexpected blank lower-right canvas`);
    fullFrameChecks.push({ name, lowerRightVariation: Number(variation.toFixed(2)) });
  }
  await page.evaluate(async () => {
    const store = (await import('/src/store/useEditorStore.js')).default;
    store.setState({ tabs: [], tabRenderList: [], activeTabId: null });

  });
  const duration = (captured.durationMs / 1000).toFixed(3);
  const palette = path.join(artifacts, 'palette.png');
  const temporaryOutput = path.join(artifacts, 'hero-smooth.gif');
  const run = args => new Promise((resolve, reject) => {
    const task = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true });
    let log = '';
    task.stderr.on('data', chunk => { log = (log + chunk).slice(-4000); });
    task.on('error', reject);
    task.on('close', code => code === 0 ? resolve() : reject(new Error('FFmpeg ' + code + ': ' + log)));
  });
  console.log(`Encoding ${recordingSize.width}×${recordingSize.height} video at ${fps} fps…`);
  const videoInput = ['-t', duration, '-i', videoPath];
  await run([...videoInput, '-vf', `fps=${fps},palettegen=max_colors=256:stats_mode=full`, '-frames:v', '1', palette]);
  await run([...videoInput, '-i', palette, '-lavfi', `[0:v]fps=${fps}[v];[v][1:v]paletteuse=dither=none:diff_mode=rectangle`, '-loop', '0', temporaryOutput]);
  const metadata = await sharp(temporaryOutput, { animated: true, limitInputPixels: false }).metadata();
  assert.equal(metadata.width, recordingSize.width);
  assert.equal(metadata.pageHeight, recordingSize.height);
  assert.ok(metadata.delay.every(delay => delay === 1000 / fps));
  assert.ok(metadata.pages > durationMs / 1000 * fps * 0.8);
  await fs.copyFile(temporaryOutput, output);
  const report = { background: 'src/assets/characters/昼夜双生的星光书页.png',
    transparency: { light: 85, dark: 85 }, viewport: { width: 1280, height: 800 },
    output: 'screenshots/hero-demo.gif', resolution: recordingSize, colours: 256, frames: metadata.pages, fps, durationMs, capture: captured, fullFrameChecks,
    bytes: (await fs.stat(output)).size, backend: 'headless browser demo adapter; actual isolated Node.js execution', cursor: 'ghost-cursor paths; live CSS hit-testing; pointer hidden while typing', pointerStats,
    caret: 'native blinking caret, preserved by continuous video capture',
    authoring: { createdFromBlank: true, newDocumentViaUI: true, basicSyntax: ['headings', 'emphasis', 'quote', 'tasks', 'fenced-code', 'table'], source: authoredSource }, chapters, errors };
  await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(`Failed during ${stage}:`, error);
  if (browser?.contexts()[0]?.pages()[0]) {
    const page = browser.contexts()[0].pages()[0];
    await page.screenshot({ path: path.join(artifacts, 'error.png') }).catch(() => {});
    console.error((await page.locator('body').innerText()).slice(0, 1800));
  }
  throw error;
} finally {
  await recorder?.stop().catch(() => {});
  await browser?.close();
  server?.kill();
}
