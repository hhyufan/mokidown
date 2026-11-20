import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { PluginKey } from '@milkdown/kit/prose/state';

export const comparisonLayoutKey = new PluginKey('moki-comparison-layout');

const isBlankParagraph = (node) => node.type.name === 'paragraph' && !node.content.size;
const listTypes = new Set(['bullet_list', 'ordered_list']);

function visitBlocks(doc, layout, visit) {
  let index = 0;
  let nextBlank = 1;
  let matches = true;
  doc.forEach((node, position) => {
    const source = layout.blocks[index];
    if (isBlankParagraph(node) && !source?.empty) {
      const line = nextBlank++;
      if (!source || line < source.start) visit(node, position, line, line);
    } else if (source) {
      const kind = node.type.name;
      if ((source.list || listTypes.has(kind)) && source.list !== kind) matches = false;
      index++;
      nextBlank = source.end + 2;
      visit(node, position, source.start, source.end);
    } else {
      matches = false;
    }
  });
  return matches && index === layout.blocks.length;
}

export function mapComparisonDecorations(decorations, tr) {
  const mapped = decorations.map(tr.mapping, tr.doc);
  const changedFolds = mapped
    .find(undefined, undefined, ({ node }) => Boolean(node))
    .filter(({ from, spec }) => tr.doc.nodeAt(from) !== spec.node);
  return changedFolds.length ? mapped.remove(changedFolds) : mapped;
}

export function comparisonDecorations(doc, layout) {
  if (!layout) return DecorationSet.empty;
  const decorations = [];
  const folds = [];
  const positions = new Map();
  const matches = visitBlocks(doc, layout, (node, position, line, end) => {
    const row = layout.rowByLine[line];
    if (layout.foldedLines[line] && layout.foldedLines[end]) {
      folds.push(
        Decoration.node(
          position,
          position + node.nodeSize,
          {
            class: 'history-markdown-diff__hidden-draft-node',
          },
          { node },
        ),
      );
    } else if (row !== undefined && !positions.has(row)) {
      positions.set(row, position);
    }
  });
  const keys = [...layout.keys, 'end'];
  let position = doc.content.size;
  // Empty cells and folds share the next document boundary. Widget order keeps
  // them in comparison order without wrapping or repositioning editable nodes.
  for (let index = keys.length - 1; index >= 0; index--) {
    const key = keys[index];
    position = Math.min(position, positions.get(key) ?? position);
    decorations.push(
      Decoration.widget(
        position,
        (view) => {
          const marker = view.dom.ownerDocument.createElement('div');
          marker.className = 'history-markdown-draft__anchor';
          marker.dataset.historyAnchor = key;
          marker.setAttribute('aria-hidden', 'true');
          return marker;
        },
        { side: index + 1, key: `history-anchor:${key}:${index}`, ignoreSelection: true },
      ),
    );
  }
  // Positional matches alone can hide following blocks when the parser and the
  // live editor disagree about a list boundary.
  return DecorationSet.create(doc, matches ? decorations.concat(folds) : decorations);
}
