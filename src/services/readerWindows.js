import { invoke } from '@utils/tauriInvoke';
import useEditorStore from '@store/useEditorStore';
import { flushEditorBuffer } from '@utils/editorBuffer';

function getMarkdownDocument(id, anyText = false) {
  flushEditorBuffer(id);
  const store = useEditorStore.getState();
  const tab = store.tabs.find((item) => item.id === id);
  if (!tab || (!anyText && !/^(md|markdown|mdown|mdwn|mkd|mkdn|mdx)$/i.test(tab.ext))) return null;
  return {
    tab,
    document: { id: tab.id, name: tab.name, path: tab.path,
      content: store.getTabContent(id), modified: tab.modified || !tab.path,
      encoding: tab.encoding, lineEnding: tab.lineEnding },
  };
}

export async function detachMarkdownTab(id, position = {}) {
  if (!window.__TAURI_INTERNALS__) return false;
  const snapshot = getMarkdownDocument(id);
  if (!snapshot) return false;
  const { tab, document } = snapshot;
  await invoke('open_reader_window', { document, x: position.screenX ?? null, y: position.screenY ?? null });
  // A reader is not a draft owner. Keep dirty/untitled documents in the editable workspace.
  const current = useEditorStore.getState();
  if (tab.path && !document.modified && current.getTabContent(id) === document.content) current.closeTab(id);
  return true;
}

function snapshotGhost(ghost, width, height) {
  const copy = ghost.cloneNode(true);
  const originals = [ghost, ...ghost.querySelectorAll('*')];
  const copies = [copy, ...copy.querySelectorAll('*')];
  originals.forEach((element, index) => {
    const target = copies[index];
    const style = getComputedStyle(element);
    // Resolve inherited values and CSS variables before moving to another WebView.
    for (const property of Array.from(style)) target.style.setProperty(property, style.getPropertyValue(property));
    for (const attribute of [...target.attributes]) {
      if (/^(on|data-)/i.test(attribute.name) || ['id', 'class', 'tabindex', 'title'].includes(attribute.name)) {
        target.removeAttribute(attribute.name);
      }
    }
    target.style.transition = 'none';
    target.style.animation = 'none';
    target.style.visibility = 'visible';
    if (element.tagName === 'IMG') target.src = element.src;
  });
  for (const element of copy.querySelectorAll('script, style, iframe, object, embed, link, input, button')) element.remove();
  // Computed logical insets can override top/left even after assigning new values.
  // Clear both forms so the 24px shadow inset is the actual rendered grab origin.
  for (const property of Array.from(copy.style)) {
    if (/^(inset($|-)|top$|right$|bottom$|left$|margin($|-))/.test(property)) copy.style.removeProperty(property);
  }
  Object.assign(copy.style, {
    position: 'absolute', left: '24px', top: '24px', right: 'auto', bottom: 'auto', margin: '0',
    width: `${width}px`, minWidth: '0', maxWidth: `${width}px`, height: `${height}px`,
    minHeight: '0', maxHeight: `${height}px`, boxSizing: 'border-box',
    transform: 'none', visibility: 'visible', pointerEvents: 'none',
  });
  return copy.outerHTML;
}

export function buildDragPreview(source, name, ghost = source, geometry = {}) {
  const icon = source.querySelector('[class$="-icon"] img, [class$="__icon"] img, img');
  const svg = source.querySelector('[class$="-icon"] svg, [class$="__icon"] svg');
  const style = getComputedStyle(document.documentElement);
  const appearance = getComputedStyle(ghost);
  const width = ghost.offsetWidth || parseFloat(ghost.style.width) || 260;
  const height = ghost.offsetHeight || parseFloat(ghost.style.height) || 36;
  return {
    ...geometry,
    width,
    height,
    markup: snapshotGhost(ghost, width, height),
    appearance: Object.fromEntries(['fontFamily', 'fontSize', 'fontWeight', 'lineHeight',
      'paddingLeft', 'paddingRight', 'gap', 'borderRadius', 'opacity', 'boxShadow']
      .map((key) => [key, appearance[key]])),
    name: name || source.dataset.readerName || source.querySelector('.tabbar__tab-name')?.textContent || source.textContent,
    icon: icon?.src || (svg ? `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}` : ''),
    background: style.getPropertyValue('--surface').trim() || '#fff',
    color: style.getPropertyValue('--text').trim() || '#2c2c2e',
    border: style.getPropertyValue('--border').trim() || '#e5e5e7',
  };
}

// Serialize begin/cancel so cancellation also covers a preview still being created.
let watchQueue = Promise.resolve();
function watchCommand(command, args) {
  const request = watchQueue.then(() => args === undefined ? invoke(command) : invoke(command, args));
  watchQueue = request.catch(() => {});
  return request;
}

export async function beginReaderTabDetachWatch(id, preview) {
  if (!window.__TAURI_INTERNALS__) return false;
  const snapshot = getMarkdownDocument(id, true);
  if (!snapshot) return false;
  await watchCommand('begin_reader_tab_detach_watch', { document: snapshot.document, ...(preview ? { preview } : {}) });
  return true;
}

export async function beginReaderFileDetachWatch(path, name, preview) {
  if (!window.__TAURI_INTERNALS__) return false;
  const store = useEditorStore.getState();
  const existing = store.tabs.find((tab) => tab.path === path);
  const document = existing ? getMarkdownDocument(existing.id, true)?.document : { id: path, path, name };
  await watchCommand('begin_reader_tab_detach_watch', { document: { ...document, keepSource: true }, preview });
  return true;
}

export async function cancelReaderTabDetachWatch() {
  if (!window.__TAURI_INTERNALS__) return false;
  await watchCommand('cancel_reader_tab_detach_watch');
  return true;
}

export async function prepareReaderDragPreview() {
  if (!window.__TAURI_INTERNALS__ || !/Windows/i.test(navigator.userAgent)) return false;
  await watchCommand('prepare_drag_preview');
  return true;
}

export async function receiveReaderDocument(document, openFileFromPath) {
  if (!document) return;
  const { restoreEditorSession } = await import('./editorSession');
  await restoreEditorSession();
  const store = useEditorStore.getState();
  const existing = store.tabs.find((tab) => tab.id === document.id || (document.path && tab.path === document.path));
  if (existing) { store.setActiveTab(existing.id); return; }
  if (document.modified || !document.path) {
    store.restoreRecoveredTab({ ...document, tabId: document.id, content: document.content || '' });
  } else {
    await openFileFromPath(document.path, document.name);
  }
}
