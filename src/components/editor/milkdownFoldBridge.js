import { getDocumentViewState, setDocumentViewState } from '@utils/documentViewState';
import { markdownFoldAnchors } from './markdownSections';

const foldingId = 'editor.contrib.folding';

export function milkdownFoldPositions(doc, source) {
  const groups = new Map();
  for (const anchor of markdownFoldAnchors(source)) {
    if (!groups.has(anchor.kind)) groups.set(anchor.kind, []);
    groups.get(anchor.kind).push(anchor);
  }
  const indices = new Map();
  const positions = new Map();
  doc.descendants((node, pos) => {
    const index = indices.get(node.type.name) || 0;
    const anchor = groups.get(node.type.name)?.[index];
    if (!anchor) return;
    indices.set(node.type.name, index + 1);
    positions.set(pos, anchor);
  });
  return positions;
}

export function createMilkdownFoldBridge(documentId, source, serialize) {
  let previousPositions = new Map();
  let initialDoc;
  return {
    initialFolds(doc) {
      initialDoc = doc;
      const saved = getDocumentViewState(documentId, 'monaco');
      const regions = saved?.contributionsState?.[foldingId]?.collapsedRegions || [];
      const lines = new Map(regions.filter((region) => region.isCollapsed !== false)
        .map((region) => [region.startLineNumber, region.endLineNumber]));
      previousPositions = milkdownFoldPositions(doc, source);
      return new Set([...previousPositions]
        .filter(([, anchor]) => anchor.end != null && lines.get(anchor.start) === anchor.end).map(([pos]) => pos));
    },
    onFoldsChanged(state, folded, previousFolded) {
      const positions = milkdownFoldPositions(state.doc, state.doc.eq(initialDoc) ? source : serialize(state));
      const saved = getDocumentViewState(documentId, 'monaco') || {};
      const contribution = saved.contributionsState?.[foldingId] || {};
      const managedLines = new Set([...previousFolded]
        .map((pos) => previousPositions.get(pos)?.start).filter(Boolean));
      for (const pos of folded) if (positions.has(pos)) managedLines.add(positions.get(pos).start);
      const regions = (contribution.collapsedRegions || [])
        .filter((region) => !managedLines.has(region.startLineNumber));
      for (const pos of folded) {
        const anchor = positions.get(pos);
        if (anchor && anchor.end > anchor.start) regions.push({
          startLineNumber: anchor.start, endLineNumber: anchor.end, isCollapsed: true,
        });
      }
      // 仅更新折叠 memento，保留 Monaco 光标、滚动和其他 contribution 状态。
      setDocumentViewState(documentId, 'monaco', {
        ...saved,
        contributionsState: {
          ...saved.contributionsState,
          [foldingId]: { ...contribution, collapsedRegions: regions.sort((a, b) => a.startLineNumber - b.startLineNumber) },
        },
      });
      previousPositions = positions;
    },
  };
}
