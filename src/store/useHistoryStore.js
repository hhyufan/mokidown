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

/**
 * 本地历史的状态（纯 UI，不持久化）。
 *
 * `diff` 表示当前正在主编辑区对比的历史版本：{ tabId, timestamp, content }。
 * 为 null 时正常编辑。时间线（侧栏）点击版本写入 diff，编辑区据此切换为
 * 对比视图；关闭对比或切换标签后清空。
 */
const useHistoryStore = create((set, get) => ({
  diff: null,
  historyWrite: null,
  viewMode: 'preview',
  setDiff: (diff) => set({ diff, viewMode: diff?.external ? 'edit' : 'preview' }),
  openFileComparison: (tabId, content, external, label) => {
    const id = `diff:${crypto.randomUUID()}`;
    const source = useEditorStore.getState().tabs.find((tab) => tab.id === tabId);
    const name = external?.modifiedName || label || source?.name || 'diff';
    const previous = get().diff;
    if (previous?.tabId && previous.tabId !== id) {
      useEditorStore.getState().closeTabs([previous.tabId]);
    }
    useEditorStore.getState().openComparisonTab({ id, name, sourceTabId: tabId });
    set({
      diff: {
        tabId: id,
        sourceTabId: tabId,
        timestamp: ++comparisonSequence,
        content,
        external,
        label,
      },
      // Markdown 文件默认进 Markdown 对比（渲染态），源码对比留一键切换。
      viewMode:
        external &&
        [external.originalPath, external.modifiedPath].every((path) =>
          /\.(?:md|markdown|mdx)$/i.test(path),
        )
          ? 'preview'
          : 'edit',
    });
  },
  toggleViewMode: () =>
    set((state) => ({ viewMode: state.viewMode === 'preview' ? 'edit' : 'preview' })),
  clearDiff: (comparison) =>
    set((state) => (comparison && state.diff !== comparison ? state : { diff: null })),
  notifyHistoryWrite: (path) => set({ historyWrite: { path } }),
}));

export default useHistoryStore;
