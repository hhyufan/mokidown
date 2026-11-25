import { create } from 'zustand';
import useEditorStore from '@store/useEditorStore';

let comparisonSequence = Date.now();

export function isMarkdownComparison(tab, diff) {
  if (diff?.external) {
    return [diff.external.originalPath, diff.external.modifiedPath].every((path) =>
      /\.(?:md|markdown|mdx)$/i.test(path),
    );
  }
  return Boolean(
    tab &&
    (diff?.sourceTabId ?? diff?.tabId) === tab.id &&
    (/^(?:md|markdown|mdx)$/i.test(tab.ext || '') ||
      /\.(?:md|markdown|mdx)$/i.test(tab.name || tab.path || '')),
  );
}

/** 同一个变更的稳定标识：源标签 + 左右两侧路径。 */
function comparisonIdentity(sourceTabId, external) {
  return `${sourceTabId}|${external?.originalPath ?? ''}|${external?.modifiedPath ?? ''}`;
}

function viewModeFor(external) {
  return external &&
    [external.originalPath, external.modifiedPath].every((path) =>
      /\.(?:md|markdown|mdx)$/i.test(path),
    )
    ? 'preview'
    : 'edit';
}

/**
 * 本地历史的状态（纯 UI，不持久化）。
 *
 * 每处变更对应自己的一条对比记录与标签页：`comparisons` 按对比标签 id 保存，
 * `diff` 始终指向当前激活的那条。切换标签时由编辑区调用 `activateComparison`
 * 把 `diff` 换成对应记录，关闭标签时再丢弃记录。
 */
const useHistoryStore = create((set, get) => ({
  diff: null,
  comparisons: {},
  historyWrite: null,
  viewMode: 'preview',

  setDiff: (diff) => set({ diff, viewMode: diff?.external ? 'edit' : 'preview' }),

  openFileComparison: (tabId, content, external, label) => {
    const editor = useEditorStore.getState();
    const requested = editor.tabs.find((tab) => tab.id === tabId);
    const previous = Object.values(get().comparisons).find((item) => item.tabId === tabId);
    // 当前激活的是对比标签时，真正要对比的是它记录的原文件标签。
    const sourceTabId = requested?.builtin === 'diff' ? (previous?.sourceTabId ?? tabId) : tabId;
    const source = editor.tabs.find((tab) => tab.id === sourceTabId);
    const name = external?.modifiedName || label || source?.name || 'diff';
    const identity = comparisonIdentity(sourceTabId, external);
    const existing = Object.values(get().comparisons).find(
      (item) => item.identity === identity && editor.tabs.some((tab) => tab.id === item.tabId),
    );
    const id = existing?.tabId ?? `diff:${crypto.randomUUID()}`;
    editor.openComparisonTab({ id, name, sourceTabId });
    const comparison = {
      tabId: id,
      sourceTabId,
      identity,
      timestamp: ++comparisonSequence,
      content,
      external,
      label,
    };
    set((state) => ({
      comparisons: { ...state.comparisons, [id]: comparison },
      diff: comparison,
      viewMode: viewModeFor(external),
    }));
  },

  /** 切换标签时恢复该对比标签自己的数据。 */
  activateComparison: (tabId) => {
    const comparison = get().comparisons[tabId] ?? null;
    if (get().diff !== comparison) set({ diff: comparison });
  },

  /** 丢弃关闭的对比标签记录；当前 diff 指向被丢弃的记录时清空。 */
  discardComparisons: (tabIds) => {
    const discarded = new Set(tabIds);
    set((state) => {
      const comparisons = { ...state.comparisons };
      for (const id of discarded) delete comparisons[id];
      return {
        comparisons,
        diff: state.diff && discarded.has(state.diff.tabId) ? null : state.diff,
      };
    });
  },

  toggleViewMode: () =>
    set((state) => ({ viewMode: state.viewMode === 'preview' ? 'edit' : 'preview' })),

  /** 关闭一处对比：丢弃记录并关掉它自己的标签页。 */
  clearDiff: (comparison) => {
    const current = get().diff;
    const target = comparison ?? current;
    const tabId = target?.tabId;
    set((state) => {
      const comparisons = { ...state.comparisons };
      if (tabId) delete comparisons[tabId];
      return {
        comparisons,
        diff: state.diff === target ? null : state.diff,
      };
    });
    if (!tabId) return;
    const tab = useEditorStore.getState().tabs.find((item) => item.id === tabId);
    if (tab?.builtin === 'diff') useEditorStore.getState().closeTabs([tabId]);
  },

  notifyHistoryWrite: (path) => set({ historyWrite: { path } }),
}));

export default useHistoryStore;
