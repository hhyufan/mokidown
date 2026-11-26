import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

const key = new PluginKey('moki-outline-highlight');

export const milkdownOutlineHighlight = $prose(() => new Plugin({
  key,
  state: {
    init: () => DecorationSet.empty,
    apply(tr, previous) {
      const update = tr.getMeta(key);
      if (update === undefined) return tr.docChanged ? previous.map(tr.mapping, tr.doc) : previous;
      if (update === null) return DecorationSet.empty;
      const node = tr.doc.nodeAt(update);
      return node
        ? DecorationSet.create(tr.doc, [
          Decoration.node(update, update + node.nodeSize, { class: 'markdown-jump-target' }),
        ])
        : DecorationSet.empty;
    },
  },
  props: { decorations: (state) => key.getState(state) },
}));

export function highlightOutlinePosition(view, position) {
  const set = (target) => {
    if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, target).setMeta('addToHistory', false));
  };
  set(position);
  return () => set(null);
}
