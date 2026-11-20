import { create } from 'zustand';

export function isMarkdownComparison(tab, diff) {
  return Boolean(tab && diff?.tabId === tab.id && (
    /^(?:md|markdown|mdx)$/i.test(tab.ext || '') || /\.(?:md|markdown|mdx)$/i.test(tab.name || tab.path || '')
  ));
}

/**
 * 本地历史的状态（纯 UI，不持久化）。
 *
 * `diff` 表示当前正在主编辑区对比的历史版本：{ tabId, timestamp, content }。
 * 为 null 时正常编辑。时间线（侧栏）点击版本写入 diff，编辑区据此切换为
 * 对比视图；关闭对比或切换标签后清空。
 */
const useHistoryStore = create((set) => ({
  diff: null,
  historyWrite: null,
  viewMode: 'preview',
  setDiff: (diff) => set({ diff, viewMode: 'preview' }),
  toggleViewMode: () => set((state) => ({ viewMode: state.viewMode === 'preview' ? 'edit' : 'preview' })),
  clearDiff: (comparison) => set((state) =>
    comparison && state.diff !== comparison ? state : { diff: null },
  ),
  notifyHistoryWrite: (path) => set({ historyWrite: { path } }),
}));

export default useHistoryStore;
