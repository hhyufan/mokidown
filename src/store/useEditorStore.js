/**
 * ?????????????
 *
 * ???????????????????????????????????????????
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  setBuffer,
  getBuffer,
  hasBuffer,
  clearBuffer,
  renameBuffer,
  flushEditorBuffer,
} from '@utils/editorBuffer';
import { clearMarkdownUndo, renameMarkdownUndo } from '@utils/markdownUndo';
import { historyCapture } from '@utils/tauriApi';
import { renameDocumentViewState } from '@utils/documentViewState';
import { untitledFileName } from '@utils/untitledFileName';

let untitledCounter = 1;

/**
 * 编辑器主 store。
 *
 * 拆分保存中的“标签持久化快照”和“用于 UI 渲染的 tab 元信息”，并把
 * 高频编辑内容外置到 `editorBuffer`，从而避免输入过程中反复触发全局渲染。
 */
/**
 * ?????? UI ?????????????
 */
function toTabMeta(tab) {
  if (!tab) return null;
  return {
    id: tab.id,
    name: tab.name,
    path: tab.path,
    ext: tab.ext,
    modified: !!tab.modified,
    encoding: tab.encoding || 'UTF-8',
    lineEnding: tab.lineEnding || 'LF',
    
  };
}

const useEditorStore = create(
  persist(
    (set, get) => ({
      tabs: [],
      tabRenderList: [],
      activeTabId: null,
      // 每当代码层主动替换标签内容时递增。
      // MonacoEditor 订阅这个版本号刷新 model，避免直接订阅内容对象引发
      // 过于频繁的快照比较与 React `getSnapshot` 警告。
      tabsRevision: 0,
      sidebarVisible: true,
      sidebarView: 'explorer',
      sidebarWidth: 280,
      sidebarMinWidth: 220,
      setSidebarMinWidth: (width) => set((s) => {
        const minimum = Math.max(220, Math.ceil(Number(width) || 220));
        return s.sidebarMinWidth === minimum ? s : { sidebarMinWidth: minimum };
      }),
      setSidebarWidth: (width) => set((s) => ({ sidebarWidth: Math.max(s.sidebarMinWidth, Math.min(Math.max(640, s.sidebarMinWidth), Number(width) || 280)) })),
      knowledgeJump: null,
      requestKnowledgeJump: (language, index) => set((s) => ({
        knowledgeJump: { tabId: s.activeTabId, language, index, nonce: Date.now() },
        viewMode: s.viewMode === 'edit' ? 'split' : s.viewMode,
      })),
      viewMode: 'edit',
      toolbarVisible: false,
      splitRatio: 0.5,
      uiStateUpdatedAt: 0,
      cursorPosition: { lineNumber: 1, column: 1 },
      characterCount: 0,
      // Runtime-only. Each tab can have its own unresolved disk change.
      externalFileConflicts: new Map(),

      setExternalFileConflict: (conflict) => set((state) => ({
        externalFileConflicts: new Map(state.externalFileConflicts).set(conflict.path, conflict),
      })),
      clearExternalFileConflict: (path, expected) => {
        const current = get().externalFileConflicts;
        if (!current.has(path) || (expected && current.get(path) !== expected)) return;
        const remaining = new Map(current);
        remaining.delete(path);
        set({ externalFileConflicts: remaining });
      },

      /**
       * 打开本地文件。
       *
       * `tabs` 保留持久化内容快照，`tabRenderList` 只保留渲染所需轻量元数据；
       * 真正的实时编辑内容交给 `editorBuffer` 托管。
       */
      openFile: (file) => {
        const { activeTabId } = get();
        if (activeTabId !== file.path) flushEditorBuffer(activeTabId);
        const { tabs } = get();
        const existing = tabs.find((t) => t.path === file.path);
        if (existing) {
          set({ activeTabId: existing.id });
          return;
        }
        const newTab = {
          id: file.path,
          name: file.name,
          path: file.path,
          ext: file.name.split('.').pop() || '',
          content: file.content || '',
          encoding: file.encoding || 'UTF-8',
          lineEnding: file.lineEnding || 'LF',
          modified: false,
        };
        setBuffer(newTab.id, newTab.content);
        set({
          tabs: [...tabs, newTab],
          tabRenderList: [...get().tabRenderList, toTabMeta(newTab)],
          activeTabId: newTab.id,
        });
      },

      

      /**
       * 创建未命名标签，初始内容只落在内存缓冲中，等待首次保存拿到真实路径。
       */
      createUntitledTab: () => {
        flushEditorBuffer(get().activeTabId);
        const { tabs } = get();
        const sequence = untitledCounter++;
        const id = `untitled-${Date.now()}-${sequence}`;
        let index = 1;
        let name = untitledFileName();
        while (tabs.some((tab) => tab.name === name)) name = untitledFileName(++index);
        const newTab = {
          id,
          name,
          path: '',
          ext: 'md',
          content: '',
          encoding: 'UTF-8',
          lineEnding: 'LF',
          modified: false,
        };
        setBuffer(id, '');
        set({
          tabs: [...tabs, newTab],
          tabRenderList: [...get().tabRenderList, toTabMeta(newTab)],
          activeTabId: id,
        });
      },

      /** Reorder both document snapshots and tab metadata without changing identity or buffers. */
      reorderTabs: (draggedId, targetId, after = false) => {
        const state = get();
        if (draggedId === targetId || !state.tabs.some((tab) => tab.id === draggedId) || !state.tabs.some((tab) => tab.id === targetId)) return;
        const order = state.tabRenderList.map((tab) => tab.id).filter((id) => id !== draggedId);
        order.splice(order.indexOf(targetId) + (after ? 1 : 0), 0, draggedId);
        if (order.every((id, index) => state.tabRenderList[index].id === id)) return;
        const tabsById = new Map(state.tabs.map((tab) => [tab.id, tab]));
        const metaById = new Map(state.tabRenderList.map((tab) => [tab.id, tab]));
        set({ tabs: order.map((id) => tabsById.get(id)), tabRenderList: order.map((id) => metaById.get(id)) });
      },

      /** Restore a session in one update; files opened meanwhile retain priority. */
      restoreSessionTabs: (restoredTabs, activeId, initialTabs = null) => {
        const current = get();
        const tabsToKeep = current.tabs === initialTabs ? [] : current.tabs;
        const existing = new Map(tabsToKeep.map((tab) => [tab.id, tab]));
        const paths = new Set(tabsToKeep.map((tab) => tab.path).filter(Boolean));
        const unique = new Map();
        for (const tab of restoredTabs) {
          if (existing.has(tab.id)) continue;
          const duplicate = tab.path && paths.has(tab.path);
          if (duplicate && !tab.modified) continue;
          if (tab.path) paths.add(tab.path);
          unique.set(tab.id, { ...tab, path: duplicate ? '' : tab.path, ext: tab.ext || tab.name.split('.').pop() || 'md' });
        }
        for (const tab of tabsToKeep) unique.set(tab.id, tab);
        const tabs = [...unique.values()];
        for (const tab of tabs) if (!existing.has(tab.id)) setBuffer(tab.id, tab.content || '');
        set({ tabs, tabRenderList: tabs.map(toTabMeta),
          activeTabId: (tabsToKeep.length && current.activeTabId) || (unique.has(activeId) ? activeId : tabs[0]?.id || null),
          tabsRevision: current.tabsRevision + 1 });
        for (const tab of tabs) {
          const number = /^Untitled-(\d+)(?:\.md)?$/.exec(tab.name)?.[1];
          if (number) untitledCounter = Math.max(untitledCounter, Number(number) + 1);
        }
      },

      /** Restore a draft as a dirty tab without writing over its original disk file. */
      restoreRecoveredTab: (draft) => {
        flushEditorBuffer(get().activeTabId);
        const { tabs, tabRenderList } = get();
        const baseId = draft.tabId || draft.path || `recovered-${Date.now()}`;
        const path = draft.path || '';
        const existing = tabs.find((tab) => path ? tab.path === path : tab.id === baseId && !tab.path);
        const content = draft.content || '';
        const metadata = {
          encoding: draft.encoding || existing?.encoding || 'UTF-8',
          lineEnding: draft.lineEnding || existing?.lineEnding || 'LF',
        };
        if (existing && !existing.modified && getBuffer(existing.id, existing.content) === existing.content) {
          get().replaceTabContent(existing.id, { ...metadata, content }, { modified: true, activate: true });
          return existing.id;
        }
        const id = tabs.some((tab) => tab.id === baseId)
          ? `recovered-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
          : baseId;
        const recovered = {
          id,
          name: draft.name || 'Recovered.md',
          // A second dirty copy must have its own editor and Save As target.
          path: existing || ['missing', 'blocked'].includes(draft.diskState) ? '' : path,
          ext: (draft.name || '').split('.').pop() || 'md',
          content: existing ? '' : draft.diskContent || '',
          ...metadata,
          modified: true,
        };
        setBuffer(id, content);
        set({
          tabs: [...tabs, recovered],
          tabRenderList: [...tabRenderList, toTabMeta(recovered)],
          activeTabId: id,
          tabsRevision: get().tabsRevision + 1,
        });
        return id;
      },

      /** ????????????????????? */
      renameTab: (tabId, newName) => {
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, name: newName, ext: newName.split('.').pop() || t.ext } : t
          ),
          tabRenderList: state.tabRenderList.map((t) =>
            t.id === tabId ? { ...t, name: newName, ext: newName.split('.').pop() || t.ext } : t
          ),
        }));
      },

      /**
       * 为标签绑定真实路径。
       *
       * 常用于未命名标签首次保存或外部云文档“认领”为本地文件后，顺带把
       * `editorBuffer` 的键也从旧 tabId 迁移到新路径。
       */
      updateTabPath: (tabId, path, name) => {
        renameDocumentViewState(tabId, path);
        renameBuffer(tabId, path);
        renameMarkdownUndo(tabId, path);
        const oldPath = get().tabs.find((tab) => tab.id === tabId)?.path;
        get().clearExternalFileConflict(oldPath);
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  id: path,
                  path,
                  name,
                  ext: name.split('.').pop() || '',
                  
                }
              : t
          ),
          tabRenderList: state.tabRenderList.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  id: path,
                  path,
                  name,
                  ext: name.split('.').pop() || '',
                  
                }
              : t
          ),
          activeTabId: state.activeTabId === tabId ? path : state.activeTabId,
        }));
      },

      /** ??????????????? */
      setCursorPosition: (pos) => set({ cursorPosition: pos }),
      /** ?????????????? */
      setCharacterCount: (count) => set({ characterCount: count }),

      /** ??????????????????????? */
      closeTab: (tabId) => {
        // 退出文档时，若内容相对上一次快照有变化，捕获终态——它同时是
        // 下次进入该文档时的“初始状态”。清理 buffer 前必须读取正文。
        const closing = get().tabs.find((t) => t.id === tabId);
        if (closing && closing.path && !/^[a-z][a-z\d+.-]*:\/\//i.test(closing.path) && !closing.path.startsWith('content://')) {
          historyCapture(closing.path, getBuffer(tabId, closing.content || '')).catch(() => {});
        }
        clearBuffer(tabId);
        clearMarkdownUndo(tabId);
        get().clearExternalFileConflict(closing?.path);
        const { tabs, activeTabId } = get();
        const filtered = tabs.filter((t) => t.id !== tabId);
        let nextActive = activeTabId;
        if (activeTabId === tabId) {
          nextActive = filtered.length > 0 ? filtered[filtered.length - 1].id : null;
        }
        set({
          tabs: filtered,
          tabRenderList: get().tabRenderList.filter((t) => t.id !== tabId),
          activeTabId: nextActive,
        });
      },

      /** ??????????? */
      setActiveTab: (tabId) => {
        const { activeTabId } = get();
        if (tabId === activeTabId) return;
        flushEditorBuffer(activeTabId);
        set({ activeTabId: tabId });
      },

      /**
       * 只更新标签脏状态，不直接改写内容本身。
       *
       * 编辑流程通常在“保存后第一次输入”时调用它；实时正文仍保存在
       * `editorBuffer` 中，等到持久化成功后再回写到 `tabs`。
       */
      markTabDirty: (tabId, modified = true) => {
        if (!tabId) return;
        const tab = get().tabRenderList.find((t) => t.id === tabId);
        if (!tab || tab.modified === modified) return;
        set((state) => ({
          
          // 两处都要同步 modified，避免冲突检测读到过期脏状态。
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, modified } : t
          ),
          tabRenderList: state.tabRenderList.map((t) =>
            t.id === tabId ? { ...t, modified } : t
          ),
        }));
      },

      /**
       * 用外部内容快照替换指定标签的持久化内容。
       *
       * 常用于文件监听器回写、远端同步落盘等场景；如果 patch 中包含文本，
       * 会先同步更新 `editorBuffer`，再推进 `tabsRevision` 通知编辑器刷新。
       */
      replaceTabContent: (tabId, patch = {}, { modified = false, activate = false } = {}) => {
        const tab = get().tabs.find((item) => item.id === tabId);
        if (!tab) return false;
        const next = { ...tab, ...patch, modified, contentRevision: (tab.contentRevision ?? 0) + 1 };
        if (typeof patch.content === 'string') {
          clearMarkdownUndo(tabId);
          setBuffer(tabId, patch.content);
          if (modified) next.content = tab.content;
        }
        set((state) => ({
          tabs: state.tabs.map((item) => item.id === tabId ? next : item),
          tabRenderList: state.tabRenderList.map((item) => item.id === tabId ? { ...item, ...toTabMeta(next) } : item),
          tabsRevision: state.tabsRevision + 1,
          ...(activate ? { activeTabId: tabId } : {}),
        }));
        return true;
      },

      /** ????? `fileId` ????????? */
      

      /**
       * 保存实际落盘的快照；保存期间的新输入继续保持未保存状态。
       */
      markTabSaved: (tabId, savedContent) => {
        if (!tabId) return;
        const liveContent = getBuffer(tabId, undefined);
        set((state) => {
          const tab = state.tabs.find((t) => t.id === tabId);
          const content = savedContent ?? liveContent ?? tab?.content;
          const modified = (liveContent ?? tab?.content) !== content;
          return {
            tabs: state.tabs.map((t) =>
              t.id === tabId
                ? { ...t, content: typeof content === 'string' ? content : t.content, modified }
                : t
            ),
            tabRenderList: state.tabRenderList.map((t) =>
              t.id === tabId ? { ...t, modified } : t
            ),
          };
        });
      },

      /** ???????????????????????? */
      getTabContent: (tabId) => {
        if (!tabId) return '';
        if (hasBuffer(tabId)) return getBuffer(tabId, '');
        return get().tabs.find((t) => t.id === tabId)?.content || '';
      },

      /**
       * 获取当前激活标签的“实时视图”。
       *
       * 返回值会优先合并缓冲区中的最新正文与 `tabRenderList` 中的脏状态。
       */
      getActiveTab: () => {
        const { tabs, activeTabId } = get();
        const tab = tabs.find((t) => t.id === activeTabId) || null;
        if (!tab) return null;
        const meta = get().tabRenderList.find((t) => t.id === activeTabId);
        const buffered = hasBuffer(tab.id) ? getBuffer(tab.id, tab.content) : tab.content;
        return {
          ...tab,
          content: buffered,
          modified: meta?.modified ?? tab.modified,
        };
      },

      /** ?????????????????????? */
      getTabByPath: (path) => {
        if (!path) return null;
        const tab = get().tabs.find((t) => t.path === path) || null;
        if (!tab) return null;
        const meta = get().tabRenderList.find((t) => t.id === tab.id || t.path === path);
        // 优先读取实时编辑缓冲区，避免使用落后于编辑器的持久化内容。
        const buffered = hasBuffer(tab.id) ? getBuffer(tab.id, tab.content) : tab.content;
        return {
          ...tab,
          content: buffered,
          modified: meta?.modified ?? tab.modified,
        };
      },

      /** ????? `fileId` ?????????? */
      

      /** ??????????? UI ?????? */
      toggleSidebar: () => set((s) => ({
        sidebarVisible: !s.sidebarVisible,
        uiStateUpdatedAt: Date.now(),
      })),
      /** ???????????? */
      setSidebarVisible: (visible, meta = {}) => set({
        sidebarVisible: visible,
        uiStateUpdatedAt: meta.updatedAt ?? Date.now(),
      }),
      setSidebarView: (view, meta = {}) => set({
        sidebarView: view,
        uiStateUpdatedAt: meta.updatedAt ?? Date.now(),
      }),

      /** ?????????? */
      setViewMode: (mode, meta = {}) => {
        const { activeTabId, viewMode } = get();
        if (viewMode !== mode) flushEditorBuffer(activeTabId);
        set({ viewMode: mode, uiStateUpdatedAt: meta.updatedAt ?? Date.now() });
      },
      toggleEditPreview: () => {
        const { viewMode, setViewMode } = get();
        if (viewMode !== 'split') setViewMode(viewMode === 'edit' ? 'preview' : 'edit');
      },
      /** ????????????????? */
      toggleSplit: () => {
        const { viewMode, setViewMode } = get();
        setViewMode(viewMode === 'split' ? 'edit' : 'split');
      },

      toggleToolbar: () => set((s) => ({
        toolbarVisible: !s.toolbarVisible,
        uiStateUpdatedAt: Date.now(),
      })),
      setSplitRatio: (value) => set({ splitRatio: Math.max(0.15, Math.min(0.85, value)) }),
      setToolbarVisible: (v, meta = {}) => set({
        toolbarVisible: v,
        uiStateUpdatedAt: meta.updatedAt ?? Date.now(),
      }),

      applyLayoutSnapshot: (uiState = {}, meta = {}) => set((state) => ({
        sidebarVisible: typeof uiState.sidebarVisible === 'boolean'
          ? uiState.sidebarVisible
          : state.sidebarVisible,
        sidebarView: uiState.sidebarView || state.sidebarView,
        viewMode: uiState.viewMode || state.viewMode,
        toolbarVisible: typeof uiState.toolbarVisible === 'boolean'
          ? uiState.toolbarVisible
          : state.toolbarVisible,
        uiStateUpdatedAt: meta.updatedAt ?? state.uiStateUpdatedAt ?? Date.now(),
      })),
    }),
    {
      name: 'mokidown-editor',
      partialize: (state) => ({
        sidebarVisible: state.sidebarVisible,
        sidebarView: state.sidebarView,
        sidebarWidth: state.sidebarWidth,
        viewMode: state.viewMode,
        toolbarVisible: state.toolbarVisible,
        splitRatio: state.splitRatio,
        uiStateUpdatedAt: state.uiStateUpdatedAt,
      }),
    }
  )
);

export default useEditorStore;
