import { Plugin, PluginKey, Selection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import i18n from '@/i18n';
import { headingSections } from './markdownSections';

const key = new PluginKey('moki-markdown-folds');
const isList = (node) => node.type.name === 'ordered_list' || node.type.name === 'bullet_list';

function ellipsis(doc) {
  const marker = doc.createElement('span');
  marker.className = 'md-preview__fold-ellipsis';
  marker.setAttribute('aria-hidden', 'true');
  return marker;
}

function foldWidget(position, kind, offset) {
  return Decoration.widget(position, (view, getPos) => {
    const doc = view.dom.ownerDocument;
    const button = doc.createElement('button');
    button.className = 'md-preview__fold';
    button.type = 'button';
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      const pos = getPos();
      if (pos != null) view.dispatch(view.state.tr.setMeta(key, pos - offset).setMeta('addToHistory', false));
    });
    if (kind !== 'code') return button;

    const wrapper = doc.createElement('div');
    wrapper.className = 'moki-code-fold';
    const summary = doc.createElement('span');
    summary.className = 'md-preview__folded-code-summary';
    summary.append(doc.createTextNode(''), ellipsis(doc));
    wrapper.append(button, summary);
    return wrapper;
  }, { side: -10, key: `fold-control:${kind}`, ignoreSelection: true, stopEvent: () => true });
}

function build(doc, candidates) {
  const blocks = [];
  doc.forEach((node, start) => blocks.push({ start, size: node.nodeSize, level: node.type.name === 'heading' ? node.attrs.level : 0 }));
  const sections = new Map(headingSections(blocks, doc.content.size).map((section) => [section.start, section.end]));
  const decorations = [];
  const folded = new Set();
  const ranges = [];
  let hiddenUntil = 0;
  for (const { start, size } of blocks) {
    if (start < hiddenUntil) decorations.push(Decoration.node(start, start + size, { class: 'moki-folded-block' }));
    const end = sections.get(start);
    if (end > start + size && candidates.has(start)) hiddenUntil = end;
  }
  doc.descendants((node, start, parent) => {
    const end = start + node.nodeSize;
    const sectionEnd = parent === doc ? sections.get(start) : 0;
    const isHeading = sectionEnd > end;
    const isCode = node.type.name === 'code_block';
    const isItem = node.type.name === 'list_item' && node.firstChild?.isTextblock && node.children.some(isList);
    if (!isHeading && !isCode && !isItem) return;

    const collapsed = candidates.has(start);
    if (collapsed) folded.add(start);
    if (isHeading || isItem) {
      const labelStart = start + (isItem ? 2 : 1);
      const labelSize = (isItem ? node.firstChild : node).content.size;
      decorations.push(
        Decoration.node(start, end, { class: isItem ? 'md-preview__foldable-item' : 'moki-foldable-heading', 'data-md-collapsed': String(collapsed) }),
        foldWidget(labelStart, isItem ? 'item' : 'heading', labelStart - start),
        Decoration.widget(labelStart + labelSize, (view) => ellipsis(view.dom.ownerDocument),
          { side: 1, marks: [], key: 'fold-ellipsis', ignoreForCoords: true, ignoreSelection: true }),
      );
      if (collapsed && isHeading) ranges.push({ from: end, to: sectionEnd });
      if (collapsed && isItem) node.forEach((child, offset) => {
        if (isList(child)) ranges.push({ from: start + 1 + offset, to: start + 1 + offset + child.nodeSize });
      });
    } else {
      decorations.push(foldWidget(start, 'code', 0), Decoration.node(start, end, {
        class: collapsed ? 'moki-folded-block' : '',
        'data-md-collapsed': String(collapsed), 'data-fold-language': node.attrs.language || '',
      }));
      if (collapsed) ranges.push({ from: start, to: end, code: true });
    }
  });
  return { folded, ranges, decorations: DecorationSet.create(doc, decorations) };
}

function updateControls(view) {
  for (const button of view.dom.querySelectorAll('button.md-preview__fold')) {
    const codeWidget = button.parentElement.closest('.moki-code-fold');
    const fold = codeWidget ? codeWidget.nextElementSibling : button.closest('[data-md-collapsed]');
    if (!fold?.hasAttribute('data-md-collapsed')) continue;
    const collapsed = fold.dataset.mdCollapsed === 'true';
    if (codeWidget) {
      codeWidget.dataset.mdCollapsed = String(collapsed);
      codeWidget.querySelector('.md-preview__folded-code-summary').firstChild.nodeValue = `\`\`\`${fold.dataset.foldLanguage || ''}`;
    }
    const label = i18n.t(collapsed ? 'editor.expandSection' : 'editor.collapseSection');
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-expanded', String(!collapsed));
    button.title = label;
  }
}

export const milkdownHeadingFolds = $prose(() => new Plugin({
  key,
  state: {
    init: (_, { doc }) => build(doc, new Set()),
    apply(tr, previous) {
      const toggle = tr.getMeta(key);
      if (!tr.docChanged && toggle == null) return previous;
      const folded = new Set();
      for (const position of previous.folded) {
        const mapped = tr.mapping.mapResult(position, 1);
        if (!mapped.deleted) folded.add(mapped.pos);
      }
      if (toggle != null) {
        if (folded.has(toggle)) folded.delete(toggle);
        else folded.add(toggle);
      }
      return build(tr.doc, folded);
    },
  },
  view(view) {
    updateControls(view);
    return { update(view, previous) {
      if (key.getState(view.state) !== key.getState(previous)) updateControls(view);
    } };
  },
  appendTransaction(transactions, previous, state) {
    if (!state.selection.empty || !transactions.some((tr) => tr.selectionSet || tr.getMeta(key) != null)) return null;
    const pos = state.selection.head;
    const { ranges } = key.getState(state);
    const range = ranges.find(({ from, to }) => pos >= from && pos < to);
    if (!range) return null;
    const forward = (range.code || !transactions.some((tr) => tr.getMeta(key) != null) && pos > previous.selection.head) &&
      range.to < state.doc.content.size;
    const target = forward ? range.to : Math.max(0, range.from - 1);
    const selection = Selection.near(state.doc.resolve(target), forward ? 1 : -1);
    if (ranges.some(({ from, to }) => selection.head >= from && selection.head < to)) return null;
    return state.tr.setSelection(selection).setMeta('addToHistory', false);
  },
  props: { decorations: (state) => key.getState(state).decorations },
}));
