import useEditorStore from '@store/useEditorStore';
import useConfigStore from '@store/useConfigStore';

import { readFileContent, startFileWatching, isSafUri } from '@utils/tauriApi';
import { isMarkdownPath, loadMilkdownEditor } from '@utils/editorRendererBoot';
import { rememberDiskBaseline } from './localFileGuard';
import {
  restoreDocumentViewStates,
  snapshotDocumentViewStates,
  subscribeDocumentViewState,
} from '@utils/documentViewState';

const STORAGE_KEY = 'mokidown-session';
let restorePromise;
let restored = false;
let timer;

function readSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved?.version === 1 && Array.isArray(saved.tabs)) return saved;
    // Older versions may have kept tabs in the editor store itself.
    const legacy = JSON.parse(localStorage.getItem('mokidown-editor') || 'null')?.state;
    return Array.isArray(legacy?.tabs) ? { ...legacy, version: 1 } : null;
  } catch (error) {
    console.warn('[session] Could not read previous workspace:', error);
    return null;
  }
}
// Capture before cursor/layout updates overwrite a legacy editor snapshot.
const savedAtBoot = readSession();

async function loadTab(tab) {
  if (!tab || typeof tab.id !== 'string' || typeof tab.name !== 'string') return null;

  if (!tab.path) return { ...tab, content: tab.content || '', modified: !!tab.modified };
  try {
    const disk = await readFileContent(tab.path);
    if (!disk?.success) return tab.modified && typeof tab.content === 'string' ? tab : null;
    rememberDiskBaseline(tab.path, disk.content || '', disk);
    if (window.__TAURI_INTERNALS__ && !isSafUri(tab.path)) {
      void startFileWatching(tab.path).catch((error) =>
        console.warn('[session] Could not watch restored file:', error),
      );
    }
    const legacyDraft = tab.modified && typeof tab.content === 'string';
    return {
      ...tab,
      content: legacyDraft ? tab.content : disk.content || '',
      encoding: disk.encoding || tab.encoding,
      lineEnding: disk.line_ending || tab.lineEnding,
      modified: !!legacyDraft,
    };
  } catch (error) {
    console.warn('[session] Could not reopen file:', tab.path, error);
    return null;
  }
}

export function restoreEditorSession() {
  if (!restorePromise) {
    restorePromise = (async () => {
      if (useConfigStore.getState().restoreLastSession === false) return;
      if (!savedAtBoot) return;
      restoreDocumentViewStates(savedAtBoot.views);
      const { tabs: initialTabs, viewMode } = useEditorStore.getState();
      const active = savedAtBoot.tabs.find((tab) => tab?.id === savedAtBoot.activeTabId);
      if (!savedAtBoot.settingsActive && viewMode === 'preview' && isMarkdownPath(active?.name)) {
        void loadMilkdownEditor().catch(() => {});
      }
      const tabs = new Array(savedAtBoot.tabs.length);
      // Bound native reads; Promise.all preserves order through indexed results.
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, tabs.length) }, async () => {
          while (next < tabs.length) {
            const index = next++;
            tabs[index] = await loadTab(savedAtBoot.tabs[index]);
          }
        }),
      );
      useEditorStore
        .getState()
        .restoreSessionTabs(tabs.filter(Boolean), savedAtBoot.activeTabId, initialTabs);
      if (savedAtBoot.settingsOpen) {
        useEditorStore.getState().openSettingsTab();
        if (!savedAtBoot.settingsActive && savedAtBoot.activeTabId) {
          useEditorStore.getState().setActiveTab(savedAtBoot.activeTabId);
        }
      }
    })().finally(() => {
      restored = true;
    });
  }
  return restorePromise;
}

export function flushEditorSession() {
  clearTimeout(timer);
  timer = undefined;
  // Startup must not replace yesterday's session with a temporary empty store.
  if (!restored) return;
  const { tabs, activeTabId } = useEditorStore.getState();
  const files = tabs.filter((tab) => !tab.builtin);
  const snapshot = {
    version: 1,
    activeTabId: files.some((tab) => tab.id === activeTabId)
      ? activeTabId
      : (files.at(-1)?.id ?? null),
    tabs: files.map(({ id, name, path, ext, encoding, lineEnding, externalFileId }) => ({
      id,
      name,
      path,
      ext,
      encoding,
      lineEnding,
      externalFileId,
    })),
    views: snapshotDocumentViewStates(files.map((tab) => tab.id)),
    settingsOpen: tabs.some((tab) => tab.builtin === 'settings'),
    settingsActive: tabs.some((tab) => tab.builtin === 'settings' && tab.id === activeTabId),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    console.warn('[session] Could not save workspace:', error);
  }
}

export function scheduleEditorSession() {
  // Throttle instead of resetting a debounce forever during continuous scrolling.
  if (!restored || timer !== undefined) return;
  timer = setTimeout(flushEditorSession, 700);
}

export function startEditorSessionTracking() {
  const unsubscribeStore = useEditorStore.subscribe((state, previous) => {
    if (state.tabRenderList !== previous.tabRenderList) {
      const metadataChanged =
        state.tabRenderList.length !== previous.tabRenderList.length ||
        state.tabRenderList.some((tab, index) =>
          ['id', 'name', 'path', 'externalFileId'].some(
            (key) => tab[key] !== previous.tabRenderList[index]?.[key],
          ),
        );
      if (metadataChanged) {
        flushEditorSession();
        return;
      }
    }
    if (state.activeTabId !== previous.activeTabId) flushEditorSession();
  });
  const unsubscribeViews = subscribeDocumentViewState(scheduleEditorSession);
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flushEditorSession();
  };
  window.addEventListener('pagehide', flushEditorSession);
  window.addEventListener('blur', flushEditorSession);
  document.addEventListener('visibilitychange', onVisibility);
  flushEditorSession();
  return () => {
    flushEditorSession();
    unsubscribeStore();
    unsubscribeViews();
    window.removeEventListener('pagehide', flushEditorSession);
    window.removeEventListener('blur', flushEditorSession);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
