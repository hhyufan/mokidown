import { parserCtx, serializerCtx } from '@milkdown/kit/core';
import { historyProviderPlugin } from '@milkdown/kit/plugin/history';
import { isHistoryTransaction, redoDepth, undoDepth } from '@milkdown/kit/prose/history';
import { Plugin, Selection } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { getBuffer } from '@utils/editorBuffer';
import { markdownUndoStep, noteNativeMarkdownUndo, recordMarkdownEdit } from '@utils/markdownUndo';
import { persistentMilkdownDocument } from './milkdownEditingFlow';

export function milkdownSharedHistory(tabId, isCurrent) {
  return $prose((ctx) => {
    let group;
    let atInitialState = true;
    return new Plugin({
      appendTransaction(transactions, previous, next) {
        if (!isCurrent() || next.doc === previous.doc) return null;
        const depth = undoDepth(next);
        const previousDepth = undoDepth(previous);
        if (transactions.some(isHistoryTransaction)) {
          if (depth !== previousDepth) noteNativeMarkdownUndo(tabId, depth < previousDepth ? -1 : 1);
          group = undefined;
          atInitialState = false;
          return null;
        }
        if (!depth || !transactions.some((tr) => tr.docChanged && tr.getMeta('addToHistory') !== false)) return null;
        const serializer = ctx.get(serializerCtx);
        const previousDoc = persistentMilkdownDocument(previous);
        const nextDoc = persistentMilkdownDocument(next);
        const before = atInitialState ? getBuffer(tabId) : () => serializer(previousDoc);
        atInitialState = false;
        if (!group || depth !== previousDepth || redoDepth(previous)) group = Symbol();
        recordMarkdownEdit(tabId, group, before, () => serializer(nextDoc));
        return null;
      },
    });
  });
}

export function replayMilkdownHistory(ctx, view, tabId, direction) {
  if (view.isDestroyed || !view.editable || view.composing) return null;
  if (direction < 0 ? undoDepth(view.state) : redoDepth(view.state)) return null;
  const step = markdownUndoStep(tabId, direction, getBuffer(tabId));
  if (!step) return null;
  const doc = ctx.get(parserCtx)(step.text);
  if (!doc) return null;

  const { state } = view;
  const tr = state.tr.replaceWith(0, state.doc.content.size, doc.content).setMeta('addToHistory', false);
  const position = Math.min(state.selection.head, tr.doc.content.size);
  view.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(position))).scrollIntoView());

  // Crossing a mode boundary invalidates the opposite native stack too.
  const { plugins } = view.state;
  const historyKey = historyProviderPlugin.key();
  view.updateState(view.state.reconfigure({
    plugins: plugins.filter((plugin) => plugin.spec.key !== historyKey),
  }).reconfigure({ plugins }));
  view.focus();
  step.commit();
  return {
    text: step.text,
    serialized: ctx.get(serializerCtx)(persistentMilkdownDocument(view.state)),
  };
}
