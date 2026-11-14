import { setDocumentViewState } from '@utils/documentViewState';

const foldingId = 'editor.contrib.folding';

export function restoreMonacoViewState(editor, state) {
  if (!state) return;
  if (state.cursorState && state.viewState) editor.restoreViewState(state);
  else editor.getContribution(foldingId)?.restoreViewState(state.contributionsState?.[foldingId]);
}

export function bindMonacoFoldControls(editor, getDocumentId) {
  const animated = editor.createDecorationsCollection();
  const hovered = editor.createDecorationsCollection();
  let foldingListener;
  let model;
  let timer;
  let active = true;
  let hoverLine;
  const markLine = (line, className) => ({
    range: { startLineNumber: line, endLineNumber: line, startColumn: 1, endColumn: 1 },
    options: { firstLineDecorationClassName: className },
  });

  const bind = () => {
    foldingListener?.dispose();
    model = null;
    hoverLine = undefined;
    clearTimeout(timer);
    const textModel = editor.getModel();
    void editor.getContribution(foldingId)?.getFoldingModel()?.then((folding) => {
      if (!active || !folding || editor.getModel() !== textModel || model === folding) return;
      model = folding;
      foldingListener = folding.onDidChange(({ collapseStateChanged }) => {
        if (!collapseStateChanged?.length) return;
        // 模式切换前就保存折叠结果，Milkdown 初始化不再依赖 Monaco 卸载时序。
        const id = getDocumentId?.();
        const state = editor.saveViewState();
        if (id && state) setDocumentViewState(id, 'monaco', state);
        animated.set(collapseStateChanged.map(({ startLineNumber }) => markLine(startLineNumber, 'moki-fold-rotating')));
        clearTimeout(timer);
        timer = setTimeout(() => animated.clear(), 240);
      });
    });
  };
  const showHover = (line) => {
    const region = line ? model?.getRegionAtLine(line) : null;
    const next = region?.startLineNumber === line ? line : undefined;
    if (next === hoverLine) return;
    hoverLine = next;
    if (next) hovered.set([markLine(next, 'moki-fold-hovered')]);
    else hovered.clear();
  };
  const subscriptions = [editor.onDidChangeModel(bind),
    editor.onMouseMove(({ target }) => showHover(target.position?.lineNumber)),
    editor.onMouseLeave(() => showHover()),
  ];
  bind();
  return () => {
    active = false;
    clearTimeout(timer);
    foldingListener?.dispose();
    for (const subscription of subscriptions) subscription.dispose();
    hovered.clear();
    animated.clear();
  };
}

export function bindMarkdownFolding(editor, setRanges) {
  let disposed = false;
  const update = () => {
    if (disposed) return;
    const regions = editor.saveViewState()?.contributionsState?.[foldingId]?.collapsedRegions || [];
    const next = regions.filter((region) => region.isCollapsed !== false).map((region) => ({
      start: region.startLineNumber, end: region.endLineNumber,
    })).sort((a, b) => a.start - b.start || b.end - a.end);
    setRanges((previous) => previous.length === next.length && previous.every((range, index) =>
      range.start === next[index].start && range.end === next[index].end) ? previous : next);
  };
  const hidden = editor.onDidChangeHiddenAreas(update);
  const model = editor.onDidChangeModel(update);
  update();
  return () => {
    disposed = true;
    hidden.dispose();
    model.dispose();
  };
}

export function toggleMonacoSection(editor, line) {
  const model = editor?.getModel();
  const pending = editor?.getContribution(foldingId)?.getFoldingModel();
  if (!model || !pending) return false;
  void pending.then((folding) => {
    if (!folding || editor.getModel() !== model) return;
    const region = folding.getRegionAtLine(line);
    if (region?.startLineNumber === line) folding.toggleCollapseState([region]);
  });
  return true;
}

function interpolate(anchors, value, from) {
  const to = 1 - from;
  let low = 0;
  let high = anchors.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (anchors[mid][from] <= value) low = mid;
    else high = mid;
  }
  const a = anchors[low], b = anchors[high];
  const fraction = (value - a[from]) / (b[from] - a[from] || 1);
  return a[to] + Math.max(0, Math.min(1, fraction)) * (b[to] - a[to]);
}

export function bindMarkdownScroll(editor, preview) {
  let frame = 0;
  let direction = 0;
  let anchors;
  let expectedPreview;
  let writingEditor = false;
  let geometryObserver;

  const measure = () => {
    const height = editor.getLayoutInfo().height;
    const editorEnd = Math.max(0, editor.getScrollHeight() - height);
    const previewEnd = Math.max(0, preview.scrollHeight - preview.clientHeight);
    const reference = preview.getBoundingClientRect().top - preview.scrollTop;
    const lineCount = editor.getModel()?.getLineCount() || 0;
    const result = [[0, 0]];
    for (const block of preview.querySelectorAll(':scope > [data-md-start]:not([hidden])')) {
      const line = Number(block.dataset.mdStart);
      if (line < 1 || line > lineCount) continue;
      const x = editor.getTopForLineNumber(line);
      const y = block.getBoundingClientRect().top - reference;
      const previous = result.at(-1);
      if (x > previous[0] && y > previous[1] && x < editorEnd && y < previewEnd) result.push([x, y]);
    }
    result.push([editorEnd, previewEnd]);
    return result;
  };

  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (preview.querySelector('.knowledge-tree-target')) return;
      anchors ||= measure();
      const ends = anchors.at(-1);
      if (!ends[0] || !ends[1]) return;
      if (direction === 0) {
        preview.scrollTop = interpolate(anchors, editor.getScrollTop(), 0);
        expectedPreview = preview.scrollTop;
      } else {
        writingEditor = true;
        editor.setScrollTop(interpolate(anchors, preview.scrollTop, 1));
        writingEditor = false;
      }
    });
  };
  const invalidate = () => { anchors = undefined; schedule(); };
  const handlePreview = () => {
    if (expectedPreview === preview.scrollTop) { expectedPreview = undefined; return; }
    direction = 1;
    schedule();
  };
  const editorScroll = editor.onDidScrollChange((event) => {
    if (event.scrollHeightChanged) anchors = undefined;
    if (writingEditor) return;
    if (event.scrollTopChanged) direction = 0;
    schedule();
  });
  const layout = editor.onDidLayoutChange(invalidate);
  const hidden = editor.onDidChangeHiddenAreas(invalidate);
  const content = editor.onDidChangeModelContent(invalidate);
  const reobserve = () => {
    geometryObserver?.disconnect();
    geometryObserver?.observe(preview);
    for (const block of preview.querySelectorAll(':scope > .md-preview__source-block')) geometryObserver?.observe(block);
  };
  if (typeof ResizeObserver === 'function') geometryObserver = new ResizeObserver(invalidate);
  const mutations = new MutationObserver((records) => {
    if (records.some((record) => record.type === 'childList' && record.target === preview)) reobserve();
    invalidate();
  });
  mutations.observe(preview, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  reobserve();
  preview.addEventListener('scroll', handlePreview, { passive: true });
  schedule();
  return () => {
    if (frame) cancelAnimationFrame(frame);
    preview.removeEventListener('scroll', handlePreview);
    mutations.disconnect();
    geometryObserver?.disconnect();
    [editorScroll, layout, hidden, content].forEach((event) => event.dispose());
  };
}
