import { TextSelection } from '@milkdown/kit/prose/state';

export function attachWritingCaret(view) {
  const pane = view.dom.closest('.md-preview--milkdown');
  if (!pane) return null;
  const document = view.dom.ownerDocument;
  const window = document.defaultView;
  const caret = document.createElement('span');
  caret.className = 'moki-writing-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.hidden = true;
  pane.append(caret);
  let frame = 0;
  let lastPosition = '';

  const hide = () => {
    if (caret.hidden) return;
    caret.hidden = true;
    view.dom.removeAttribute('data-drawn-caret');
    lastPosition = '';
  };

  const draw = () => {
    frame = 0;
    const { selection } = view.state;
    if (
      !view.editable ||
      !document.hasFocus() ||
      document.activeElement !== view.dom ||
      view.dom.matches(
        '.moki-markdown-virtual-caret, .moki-markdown-pointer-pending, .ProseMirror-hideselection',
      ) ||
      !(selection instanceof TextSelection) ||
      (!selection.empty && !view.composing)
    ) {
      hide();
      return;
    }
    const currentSelection = document.getSelection();
    if (
      !view.dom.contains(currentSelection?.focusNode) ||
      (!currentSelection.isCollapsed && !view.composing)
    ) {
      hide();
      return;
    }
    // The DOM selection gives the actual visual edge at wrapped and bidi text,
    // including the composition text that has not entered the document model yet.
    const range = document.createRange();
    range.setStart(currentSelection.focusNode, currentSelection.focusOffset);
    const native = range.getBoundingClientRect();
    const { left, top, bottom } = native.height > 0 ? native : view.coordsAtPos(selection.head);
    const box = pane.getBoundingClientRect();
    if (bottom <= box.top || top >= box.bottom || left < box.left - 1 || left > box.right) {
      hide();
      return;
    }
    const x = left - box.left + pane.scrollLeft - pane.clientLeft;
    const y = top - box.top + pane.scrollTop - pane.clientTop;
    const height = bottom - top;
    const position = `${x}:${y}:${height}`;
    if (position !== lastPosition) {
      caret.style.transform = `translate(${x}px, ${y}px)`;
      caret.style.height = `${height}px`;
      caret.hidden = false;
      view.dom.setAttribute('data-drawn-caret', '');
      const blink = caret.getAnimations()[0];
      if (blink) blink.currentTime = 0;
      lastPosition = position;
    }
  };
  const schedule = () => {
    if (view.dom.matches('.moki-markdown-virtual-caret, .moki-markdown-pointer-pending')) {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      hide();
      return;
    }
    if (!frame && (document.activeElement === view.dom || !caret.hidden))
      frame = window.requestAnimationFrame(draw);
  };
  const events = ['focus', 'input', 'compositionstart', 'compositionupdate', 'compositionend'];
  for (const name of events) view.dom.addEventListener(name, schedule);
  view.dom.addEventListener('blur', hide);
  document.addEventListener('selectionchange', schedule);
  pane.addEventListener('scroll', schedule, { capture: true, passive: true });
  window.addEventListener('blur', hide);
  window.addEventListener('focus', schedule);
  schedule();

  return {
    schedule,
    destroy() {
      for (const name of events) view.dom.removeEventListener(name, schedule);
      view.dom.removeEventListener('blur', hide);
      document.removeEventListener('selectionchange', schedule);
      pane.removeEventListener('scroll', schedule, true);
      window.removeEventListener('blur', hide);
      window.removeEventListener('focus', schedule);
      if (frame) window.cancelAnimationFrame(frame);
      hide();
      caret.remove();
    },
  };
}
