import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { PluginKey } from '@milkdown/kit/prose/state';
import { EditorView as CodeMirrorView } from '@codemirror/view';
import { comparisonLineReaders } from '../history/comparisonLineReaders';

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
      visit(node, position, source.start, source.end, source.lineSpans);
    } else {
      matches = false;
    }
  });
  return matches && index === layout.blocks.length;
}

export function bindComparisonLineReader(view, getLayout) {
  let lastLayout;
  let lastDoc;
  const lines = new Map();
  comparisonLineReaders.set(view.dom, (line) => {
    const layout = getLayout();
    if (!layout) return undefined;
    if (layout !== lastLayout || view.state.doc !== lastDoc) {
      lastLayout = layout;
      lastDoc = view.state.doc;
      lines.clear();
      visitBlocks(lastDoc, layout, (node, pos, start, end, spans = []) => {
        const add = (number, read) => {
          if (!lines.has(number)) lines.set(number, read);
        };
        for (let line = start; line <= end; line++) {
          add(line, () => view.nodeDOM(pos)?.getBoundingClientRect()?.top);
        }
        const candidates = [{ node, pos }];
        node.descendants((child, offset) => {
          if (child.isBlock) candidates.push({ node: child, pos: pos + offset + 1 });
        });
        let index = 0;
        const assigned = new Set();
        for (const span of spans) {
          const found = candidates.findIndex(
            ({ node }, i) => i >= index && node.type.name === span.kind,
          );
          if (found < 0) continue;
          index = found + 1;
          const entry = candidates[found];
          const positions = [entry.pos + 1];
          entry.node.forEach((child, offset) => {
            if (child.type.name === 'hardbreak') positions.push(entry.pos + offset + 1 + child.nodeSize);
          });
          for (let line = span.start; line <= span.end; line++) {
            if (assigned.has(line)) continue;
            assigned.add(line);
            lines.set(line, () => {
              const dom = view.nodeDOM(entry.pos);
              if (span.kind === 'code_block') {
                const cmRoot = dom?.matches?.('.cm-editor') ? dom : dom?.querySelector?.('.cm-editor');
                const cm = cmRoot && CodeMirrorView.findFromDOM(cmRoot);
                // The fence shares the first rendered code line.
                if (cm && cm.state.doc.lines)
                  return cm.documentTop + cm.lineBlockAt(
                    cm.state.doc.line(Math.min(cm.state.doc.lines, Math.max(1, line - span.start))).from,
                  ).top;
              }
              if (entry.node.inlineContent && !entry.node.isAtom) {
                const position = positions[Math.min(line - span.start, positions.length - 1)];
                return view.coordsAtPos(position, 1).top;
              }
              return dom?.getBoundingClientRect()?.top;
            });
          }
        }
      });
    }
    return lines.get(line)?.();
  });
  return () => comparisonLineReaders.delete(view.dom);
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
