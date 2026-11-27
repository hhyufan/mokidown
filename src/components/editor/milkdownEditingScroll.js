import { StateField } from '@codemirror/state';
import { EditorView as CodeMirrorView } from '@codemirror/view';
import { NodeSelection, Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

const scrollKey = new PluginKey('moki-editing-scroll');
export const milkdownCaretNavigation = 'moki-caret-navigation';
const stablePaneSelector = '.md-preview--milkdown-stable-scroll';
const growingNodes = new Set([
  'code_block',
  'html_block',
  'html',
  'image',
  'table',
  'table_source_block',
  'math_block',
  'math_source_block',
]);

function changesGrowingNode(transaction) {
  return transaction.steps.some((step, index) => {
    const doc = transaction.docs[index + 1] ?? transaction.doc;
    // Attribute-only steps can change an image or preview without moving positions.
    if (Number.isInteger(step.pos) && growingNodes.has(doc.nodeAt(step.pos)?.type.name))
      return true;
    let found = false;
    transaction.mapping.maps[index].forEach((_oldFrom, _oldTo, from, to) => {
      if (found || to <= from) return;
      doc.nodesBetween(from, to, (node) => {
        if (growingNodes.has(node.type.name)) found = true;
        return !found;
      });
    });
    return found;
  });
}

const codeEdit = StateField.define({
  create: () => false,
  update(editing, transaction) {
    if (transaction.docChanged) return true;
    return transaction.selection ? false : editing;
  },
});

function revealCaret(pane, caret, downOnly = false) {
  const paneHeight = pane.clientHeight;
  if (!caret || !paneHeight) return;
  const styles = pane.ownerDocument.defaultView.getComputedStyle(pane);
  const gap = Math.min(paneHeight / 3, parseFloat(styles.scrollPaddingBottom) || 0);
  const top = pane.getBoundingClientRect().top + pane.clientTop;
  const height = paneHeight - gap;
  const bottom = top + height;
  const edge = Math.min(caret.bottom, caret.top + height);
  if (!downOnly && caret.top < top) pane.scrollTop += caret.top - top;
  else if (edge > bottom) pane.scrollTop += edge - bottom;
}

export const milkdownCodeEditingScroll = [
  codeEdit,
  CodeMirrorView.scrollHandler.of((view, range) => {
    const pane = view.dom.closest(stablePaneSelector);
    if (!view.state.field(codeEdit) || !pane) return false;

    // Consume the request locally, then follow the caret at the document edge.
    for (const box of [view.scrollDOM, view.dom.closest('.codemirror-host')]) {
      if (!box || (box.scrollWidth <= box.clientWidth && box.scrollHeight <= box.clientHeight))
        continue;
      const caret = view.coordsAtPos(range.head);
      if (!caret) continue;
      const { top, left } = box.getBoundingClientRect();
      box.scrollLeft +=
        Math.max(0, caret.right - left - box.clientWidth) + Math.min(0, caret.left - left);
      box.scrollTop +=
        Math.max(0, caret.bottom - top - box.clientHeight) + Math.min(0, caret.top - top);
    }
    revealCaret(pane, view.coordsAtPos(range.head));
    return true;
  }),
];

function caretRect(view, active) {
  const cmRoot = active.closest('.cm-editor');
  const cm = cmRoot && view.dom.contains(cmRoot) && CodeMirrorView.findFromDOM(cmRoot);
  if (cm) return cm.coordsAtPos(cm.state.selection.main.head);
  const { selection } = view.state;
  if (selection instanceof NodeSelection)
    return view.nodeDOM(selection.from)?.getBoundingClientRect?.();
  return view.coordsAtPos(selection.head);
}

export const milkdownEditingScroll = $prose(
  () =>
    new Plugin({
      key: scrollKey,
      state: {
        init: () => ({ editing: false, canGrow: false }),
        apply(tr, previous) {
          const appendedTo = tr.getMeta('appendedTransaction');
          const root = appendedTo ?? tr;
          const editing =
            (tr.docChanged || (appendedTo && previous.editing)) &&
            !root.getMeta(milkdownCaretNavigation);
          const paste = root.getMeta('paste') || root.getMeta('uiEvent') === 'paste';
          return {
            editing: Boolean(editing),
            canGrow: Boolean(
              editing && (paste || (appendedTo && previous.canGrow) || changesGrowingNode(tr)),
            ),
          };
        },
      },
      props: {
        handleScrollToSelection(view) {
          return (
            scrollKey.getState(view.state).editing && Boolean(view.dom.closest(stablePaneSelector))
          );
        },
      },
      view(view) {
        const pane = view.dom.closest(stablePaneSelector);
        if (!pane) return {};
        const win = pane.ownerDocument.defaultView;
        let layout = view.dom.getBoundingClientRect();
        let pending = null;
        let nativeTop = null;
        let frame = 0;
        let followCaret = false;

        const clear = () => {
          pending = null;
          nativeTop = null;
          followCaret = false;
        };
        const scheduleFollow = () => {
          if (frame) return;
          frame = win.requestAnimationFrame(() => {
            frame = 0;
            if (nativeTop != null && pane.scrollTop !== nativeTop) pane.scrollTop = nativeTop;
            nativeTop = null;
            const active = pane.ownerDocument.activeElement;
            if (followCaret && active && view.dom.contains(active)) {
              revealCaret(pane, caretRect(view, active));
              if (pending) pending.top = pane.scrollTop;
            }
            followCaret = false;
          });
        };
        const beforeInput = (event) => {
          const active = pane.ownerDocument.activeElement;
          if (event.defaultPrevented || (active !== view.dom && !active?.closest('.cm-editor')))
            return;
          nativeTop ??= pane.scrollTop;
          followCaret = true;
          scheduleFollow();
        };
        const onResize = () => {
          const next = view.dom.getBoundingClientRect();
          const grew = next.height > layout.height;
          const reflowed = next.width !== layout.width;
          layout = next;
          if (reflowed) pending = null;
          if (!pending || !grew || !view.state.selection.eq(pending.selection)) return;
          const active = pane.ownerDocument.activeElement;
          if (!pane.contains(active) || Math.abs(pane.scrollTop - pending.top) > 1) {
            pending = null;
            return;
          }
          revealCaret(pane, caretRect(view, active), true);
          pending.top = pane.scrollTop;
        };
        const resize = win.ResizeObserver ? new win.ResizeObserver(onResize) : null;
        resize?.observe(view.dom);
        for (const event of ['pointerdown', 'wheel', 'touchmove'])
          pane.addEventListener(event, clear, true);
        pane.addEventListener('beforeinput', beforeInput);

        return {
          update(next, previous) {
            const { doc, selection } = next.state;
            if (doc === previous.doc) {
              if (!selection.eq(previous.selection)) clear();
              return;
            }
            const { editing, canGrow } = scrollKey.getState(next.state);
            pending = canGrow ? { selection, top: nativeTop ?? pane.scrollTop } : null;
            if (editing) {
              followCaret = true;
              scheduleFollow();
            } else {
              nativeTop = null;
              followCaret = false;
            }
          },
          destroy() {
            resize?.disconnect();
            if (frame) win.cancelAnimationFrame(frame);
            for (const event of ['pointerdown', 'wheel', 'touchmove'])
              pane.removeEventListener(event, clear, true);
            pane.removeEventListener('beforeinput', beforeInput);
          },
        };
      },
    }),
);
