import i18n from '@/i18n';
import useConfigStore from '@store/useConfigStore';
import useEditorStore from '@store/useEditorStore';
import useNotificationStore from '@store/useNotificationStore';
import useSnapshotStore from '@store/useSnapshotStore';
import useThemeStore from '@store/useThemeStore';
import { getBackgroundTransparency, readBackgroundImage } from '@utils/backgroundImage';
import { getBuffer } from '@utils/editorBuffer';
import { getFileLanguage } from '@utils/fileLanguage';
import { selectedMarkdownHtml, selectedRange, selectionElement } from '@utils/markdownSelection';
import {
  copySnapshotCanvas,
  getCardPalette,
  renderCodeSnapshotCanvas,
  renderMarkdownSnapshotCanvas,
  saveSnapshotCanvas,
  SNAPSHOT_MARKDOWN_INSET,
  snapshotMarkdownVariables,
  tokenizeSnapshotCode,
} from '@utils/snapshotExport';

const sources = new Map();

/**
 * 注册当前可见编辑器的截图采集回调，避免快捷键路径反向静态依赖 Monaco / Milkdown。
 */
export function registerSnapshotSource(kind, getter) {
  sources.set(kind, getter);
  return () => {
    if (sources.get(kind) === getter) sources.delete(kind);
  };
}

/**
 * 去掉多行代码块的公共前导缩进，保留相对缩进层级。
 */
export function trimCommonIndent(text, tabSize = 2) {
  const normalized = String(text || '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const step = Math.max(1, Math.trunc(Number(tabSize) || 2));
  const nextColumn = (character, column) => column + (character === '\t' ? step - (column % step) : 1);
  let minIndent = Infinity;
  const indents = lines.map((line) => {
    const prefix = /^[ \t]*/.exec(line)[0];
    let columns = 0;
    for (const character of prefix) columns = nextColumn(character, columns);
    if (prefix.length < line.length) minIndent = Math.min(minIndent, columns);
    return prefix;
  });
  if (!Number.isFinite(minIndent) || minIndent <= 0) return normalized;
  return lines.map((line, index) => {
    const prefix = indents[index];
    let column = 0;
    let shiftedPrefix = '';
    for (const character of prefix) {
      const endColumn = nextColumn(character, column);
      const shiftedStart = Math.max(0, column - minIndent);
      const shiftedEnd = Math.max(0, endColumn - minIndent);
      if (shiftedEnd > shiftedStart) {
        // A tab can stay a tab only if its shifted stop is still in the same place.
        shiftedPrefix += nextColumn(character, shiftedStart) === shiftedEnd
          ? character
          : ' '.repeat(shiftedEnd - shiftedStart);
      }
      column = endColumn;
    }
    return shiftedPrefix + line.slice(prefix.length);
  }).join('\n');
}

/**
 * 生成默认导出的 PNG 文件名。
 */
export function formatSnapshotFileName(fileName) {
  const rawBase = String(fileName || '')
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.[^.]+$/, '');
  const base = Array.from(rawBase || '', (ch) => (ch.charCodeAt(0) < 32 ? '-' : ch))
    .join('')
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${base || 'mokidown'}-snapshot.png`;
}

/**
 * 从当前浏览器选区（例如分栏预览）提取截图载荷。
 */
function markdownPayload(tab, content, isSelection = false) {
  return {
    mode: 'markdown',
    content,
    language: 'markdown',
    fileName: tab?.name || '',
    documentPath: tab?.path || '',
    startLine: 1,
    isSelection,
  };
}

function codePayload(code, tab, range) {
  const className = [...code.classList].find((name) => name.startsWith('language-'));
  let startLine = 1;
  if (range) {
    const prefix = code.ownerDocument.createRange();
    prefix.selectNodeContents(code);
    prefix.setEnd(range.startContainer, range.startOffset);
    startLine += (prefix.toString().match(/\n/g) || []).length;
  }
  return {
    ...markdownPayload(tab, range ? range.toString() : code.textContent, Boolean(range)),
    mode: 'code',
    language: className?.slice(9) || code.parentElement.dataset.codeLanguage || 'plaintext',
    startLine,
  };
}

function trimEmptySelectionEdge(container, edge) {
  let child = container[edge];
  while (child) {
    if (child.nodeType === 1) {
      if (child.matches('pre, code, img, input, svg, hr, video, audio, canvas')) return;
      trimEmptySelectionEdge(child, edge);
    }
    if (child.textContent.trim() || child.querySelector?.('pre, code, img, input, svg, hr, video, audio, canvas')) return;
    child.remove();
    child = container[edge];
  }
}

function prepareRenderedBlocks(container) {
  const document = container.ownerDocument;
  // Editor shells carry ProseMirror's white-space: break-spaces. Keeping the
  // shell would make source newlines split otherwise inline HTML in the card.
  for (const editor of container.querySelectorAll('.ProseMirror, .milkdown-editor, .milkdown')) {
    editor.replaceWith(...editor.childNodes);
  }
  for (const element of container.querySelectorAll('.ProseMirror-selectednode, .moki-block-selected, .selectedCell')) {
    element.classList.remove('ProseMirror-selectednode', 'moki-block-selected', 'selectedCell');
  }
  for (const block of container.querySelectorAll('.milkdown-code-block')) {
    const lines = [...block.querySelectorAll('.cm-content > .cm-line')];
    if (!lines.length) continue;
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    const language = block.dataset.language || block.querySelector('.language-button')?.textContent?.trim();
    if (language) code.className = `language-${language.toLowerCase().replace(/\s+/g, '-')}`;
    code.textContent = lines.map((line) => line.textContent).join('\n');
    pre.append(code);
    block.replaceWith(pre);
  }
  for (const formula of container.querySelectorAll('.katex-display, .katex:not(.katex-display .katex)')) {
    const latex = formula.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
    if (!latex) continue;
    const code = document.createElement('code');
    code.className = formula.classList.contains('katex-display') ? 'language-math math-display' : 'language-math math-inline';
    code.textContent = latex;
    formula.replaceWith(code);
  }
}

export function captureRenderedSelection(root, tab, range = selectedRange(root)) {
  if (!range) return null;
  const start = selectionElement(range.startContainer);
  const code = start?.closest('pre > code');
  if (code && code.contains(range.endContainer)) return codePayload(code, tab, range);

  const container = root.ownerDocument.createElement('div');
  let fragment = range.cloneContents();
  const context = selectionElement(range.commonAncestorContainer);
  const editor = context?.closest('.ProseMirror');
  const contentRoot = editor && root.contains(editor) ? editor : root;
  // Retain formatting ancestors of a clipped range, including lists and HTML layouts.
  for (let node = context; node && node !== contentRoot; node = node.parentElement) {
    const wrapper = node.cloneNode(false);
    wrapper.append(fragment);
    fragment = wrapper;
  }
  container.append(fragment);
  prepareRenderedBlocks(container);
  for (const checkbox of container.querySelectorAll('button.md-preview__task-checkbox')) {
    const input = container.ownerDocument.createElement('input');
    input.type = 'checkbox';
    if (checkbox.getAttribute('aria-checked') === 'true') input.setAttribute('checked', '');
    input.disabled = true;
    checkbox.replaceWith(input);
  }
  container.querySelectorAll([
    '[hidden]', '.md-preview__fold', '.md-preview__fold-ellipsis', '.md-preview__folded-code-summary',
    '.md-preview__html-edit', '.md-preview__html-panel', '.lang-tag', '.editor-context-menu',
    '.md-code-execution-mount', '.moki-markdown-marker', '.md-preview__selection-markers',
    '.md-preview__selection-cells',
    '.moki-code-fold', '.milkdown-code-block .language-picker',
  ].join(',')).forEach((element) => element.remove());
  trimEmptySelectionEdge(container, 'firstChild');
  trimEmptySelectionEdge(container, 'lastChild');
  const currentSelection = root.ownerDocument.getSelection();
  const content = currentSelection?.rangeCount && currentSelection.getRangeAt(0) === range
    ? currentSelection.toString()
    : container.textContent;
  if (!content.trim() && !container.querySelector('img, hr')) return null;
  return { ...markdownPayload(tab, content, true), selectionHtml: container.innerHTML };
}

export function capturePreviewSelection(root, fallbackContent, tab, target) {
  const selected = captureRenderedSelection(root, tab);
  if (selected) return selected;
  const code = target?.closest('pre')?.querySelector(':scope > code');
  if (code && root?.contains(code)) return codePayload(code, tab);
  return markdownPayload(tab, fallbackContent);
}

function hasSnapshotContent(payload) {
  return Boolean(payload?.content?.trim() || payload?.selectionHtml?.trim());
}

/**
 * 从当前聚焦的编辑器或活动标签采集代码 / Markdown 截图载荷。
 */
export function extractActiveEditorSnapshotPayload() {
  const editorState = useEditorStore.getState();
  const activeTab = editorState.tabs.find((tab) => tab.id === editorState.activeTabId) || null;
  if (!activeTab) return null;

  const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
  const selection = typeof window !== 'undefined' ? window.getSelection() : null;
  const selectionAnchor = selectionElement(selection?.anchorNode);

  const trySource = (kind) => {
    try {
      const result = sources.get(kind)?.();
      return hasSnapshotContent(result) ? result : null;
    } catch {
      return null;
    }
  };

  let payload = null;
  if (!selection?.isCollapsed && selectionAnchor?.closest('.md-preview:not(.md-preview--milkdown)')) {
    const previewRoot = selectionAnchor.closest('.md-preview:not(.md-preview--milkdown)');
    payload = captureRenderedSelection(previewRoot, activeTab);
  } else if (!selection?.isCollapsed && selectionAnchor?.closest('.md-preview--milkdown')) {
    const selected = selectedMarkdownHtml(selectionAnchor.closest('.md-preview--milkdown'));
    if (selected) payload = captureRenderedSelection(selected.root, activeTab, selected.range);
  }
  if (!payload && activeEl?.closest?.('.monaco-editor')) {
    payload = trySource('monaco');
  } else if (!payload && activeEl?.closest?.('.milkdown-editor')) {
    payload = trySource('milkdown');
  }

  if (!payload) {
    const markdown = getFileLanguage(activeTab.name) === 'markdown';
    if (markdown && editorState.viewMode === 'preview') {
      payload = trySource('milkdown');
    } else {
      payload = trySource('monaco') || trySource('milkdown');
    }
  }

  if (!payload) {
    const content = getBuffer(activeTab.id, activeTab.content || '');
    const language = getFileLanguage(activeTab.name);
    const markdown = language === 'markdown';
    payload = {
      mode: markdown && editorState.viewMode !== 'edit' ? 'markdown' : 'code',
      content,
      language,
      fileName: activeTab.name || '',
      documentPath: activeTab.path || '',
      startLine: 1,
      isSelection: false,
    };
  }

  return payload;
}

/**
 * 打开截图工坊弹窗预览与编辑截图。
 */
export function openSnapshotPayload(payload) {
  if (!hasSnapshotContent(payload)) {
    useNotificationStore.getState().notify('info', i18n.t('snapshot.empty'), '', 2500);
    return false;
  }
  useSnapshotStore.getState().openSnapshot({
    ...payload,
    tabId: useEditorStore.getState().activeTabId,
  });
  return true;
}

export function captureActiveEditorSnapshot() {
  const payload = extractActiveEditorSnapshotPayload();
  return openSnapshotPayload(payload);
}

async function resolveActiveAppBackground(dark, enabled) {
  if (!enabled) return { option: null, cleanup: () => {} };
  const config = useConfigStore.getState();
  if (!config.backgroundEnabled || !config.backgroundImage) {
    return { option: null, cleanup: () => {} };
  }
  let objectUrl = null;
  try {
    const blob = await readBackgroundImage(config.backgroundImage);
    if (!blob) return { option: null, cleanup: () => {} };
    objectUrl = URL.createObjectURL(blob);
    const transparency = getBackgroundTransparency(
      config.backgroundTransparency,
      dark ? 'dark' : 'light',
    );
    return {
      option: {
        imageUrl: objectUrl,
        opacity: (100 - transparency) / 100,
        transparency,
      },
      cleanup: () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      },
    };
  } catch {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    return { option: null, cleanup: () => {} };
  }
}

async function renderOffscreenMarkdownCanvas(payload, commonOptions, fallbackTokens) {
  const [{ createElement, createRef }, { createRoot }, { flushSync }, { default: SnapshotMarkdownBody }] =
    await Promise.all([
      import('react'),
      import('react-dom/client'),
      import('react-dom'),
      import('@components/overlays/SnapshotMarkdownBody'),
      import('@components/overlays/snapshot-modal.scss'),
    ]);

  const palette = getCardPalette(commonOptions.dark, Boolean(commonOptions.appBackground));
  const innerWidth = Math.max(1, (commonOptions.cardWidth || 680) - SNAPSHOT_MARKDOWN_INSET * 2);
  const host = document.createElement('div');
  host.style.cssText = [
    'position:fixed',
    'left:-99999px',
    'top:0',
    `width:${innerWidth}px`,
    'visibility:hidden',
    'pointer-events:none',
    'z-index:-1',
  ].join(';');
  for (const [name, value] of Object.entries(snapshotMarkdownVariables(palette))) {
    host.style.setProperty(name, value);
  }

  document.body.appendChild(host);
  const contentRef = createRef();
  const root = createRoot(host);

  try {
    flushSync(() => root.render(
      createElement(SnapshotMarkdownBody, {
        content: payload.content,
        selectionHtml: payload.selectionHtml,
        dark: commonOptions.dark,
        documentPath: payload.documentPath || '',
        contentRef,
      }),
    ));

    // Wait two animation frames for ReactMarkdown + Prism + KaTeX layout to settle.
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    // Allow async image resolution a brief moment if markdown embeds local/remote images.
    const imgs = [...(contentRef.current?.querySelectorAll('img') || [])];
    if (imgs.length) {
      await Promise.race([
        Promise.all(
          imgs.map((img) =>
            img.complete
              ? Promise.resolve()
              : new Promise((res) => {
                  img.addEventListener('load', res, { once: true });
                  img.addEventListener('error', res, { once: true });
                }),
          ),
        ),
        new Promise((res) => setTimeout(res, 1500)),
      ]);
    }

    return await renderMarkdownSnapshotCanvas(contentRef.current, {
      ...commonOptions,
      fontSize: 14,
      fallbackTokens,
    });
  } finally {
    root.unmount();
    host.remove();
  }
}

/**
 * 按「设置 → 快速截图」的预设参数静默生成截图并直接复制或保存，不弹出编辑窗口。
 */
export async function runQuickSnapshot(payload) {
  const content = String(payload?.content || '');
  const notify = useNotificationStore.getState().notify;
  if (!hasSnapshotContent(payload)) {
    notify('info', i18n.t('snapshot.empty'), '', 2500);
    return false;
  }

  const quick = useSnapshotStore.getState().quick;
  const appTheme = useThemeStore.getState().theme;
  const config = useConfigStore.getState();
  const dark = quick.cardTheme === 'auto' ? appTheme === 'dark' : quick.cardTheme === 'dark';
  const renderMode = payload?.mode === 'markdown' ? 'markdown' : 'code';
  const language = payload?.language || (renderMode === 'markdown' ? 'markdown' : 'plaintext');
  const codeFontFamily = `'${config.fontFamily || 'JetBrains Mono'}', 'Source-HanSan', Consolas, monospace`;

  const { option: appBackground, cleanup } = await resolveActiveAppBackground(
    dark,
    quick.useAppBackground,
  );

  try {
    const commonOptions = {
      dark,
      backdrop: quick.backdrop,
      padding: quick.padding,
      radius: quick.radius,
      shadow: quick.shadow,
      windowStyle: quick.windowStyle,
      showFileName: quick.showFileName,
      showFileType: quick.showFileType,
      showWatermark: quick.showWatermark,
      appBackground,
      cardWidth: quick.cardWidth,
      scale: quick.scale,
      title: String(payload?.fileName || '').trim(),
      fontFamily: codeFontFamily,
    };

    let canvas;
    if (renderMode === 'markdown') {
      const fallbackTokens = await tokenizeSnapshotCode(content, 'markdown', dark);
      canvas = await renderOffscreenMarkdownCanvas(payload, commonOptions, fallbackTokens);
    } else {
      const effectiveCode = quick.trimIndent ? trimCommonIndent(content, config.tabSize) : content;
      const tokens = await tokenizeSnapshotCode(effectiveCode, language, dark);
      canvas = await renderCodeSnapshotCanvas({
        ...commonOptions,
        tokens,
        language,
        startLine: payload?.startLine || 1,
        showLineNumbers: quick.showLineNumbers,
        showIndentMarkers: quick.showIndentMarkers,
        showIndentRainbow: quick.showIndentRainbow,
        indentRainbowStyle: config.indentRainbowStyle || 'surface',
        tabSize: config.tabSize || 2,
        fontSize: 13.5,
      });
    }

    if (quick.quickAction === 'save') {
      const suggestedName = formatSnapshotFileName(payload?.fileName);
      const result = await saveSnapshotCanvas(canvas, suggestedName);
      if (result.saved) {
        notify('success', i18n.t('snapshot.quickSaved'), suggestedName, 2600);
      }
      return Boolean(result.saved);
    }

    await copySnapshotCanvas(canvas);
    notify('success', i18n.t('snapshot.quickCopied'), '', 2400);
    return true;
  } catch (error) {
    const key = quick.quickAction === 'save' ? 'snapshot.saveFailed' : 'snapshot.copyFailed';
    notify('error', i18n.t(key), error?.message || '', 3000);
    return false;
  } finally {
    cleanup();
  }
}

export function captureActiveQuickSnapshot() {
  const payload = extractActiveEditorSnapshotPayload();
  return runQuickSnapshot(payload);
}
