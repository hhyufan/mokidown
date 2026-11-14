const highlights = new WeakMap();

function underlineFootnote(marker) {
  const doc = marker.ownerDocument;
  const bounds = marker.getBoundingClientRect();
  const walker = doc.createTreeWalker(marker, NodeFilter.SHOW_TEXT, {
    acceptNode: (text) => text.data.trim() && !text.parentElement.closest('.footnote-backref')
      ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  const range = doc.createRange();
  const lines = [];
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    range.selectNodeContents(text);
    for (const rect of range.getClientRects()) {
      if (!rect.width || !rect.height) continue;
      const line = lines.find(({ top, bottom }) => rect.top < bottom && rect.bottom > top);
      if (line) {
        line.left = Math.min(line.left, rect.left);
        line.right = Math.max(line.right, rect.right);
        line.bottom = Math.max(line.bottom, rect.bottom);
      } else {
        lines.push({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right });
      }
    }
  }
  const overlay = doc.createElement('span');
  overlay.className = 'footnote-jump-lines';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.contentEditable = 'false';
  for (const { left, right, bottom } of lines) {
    const underline = doc.createElement('i');
    underline.style.left = `${left - bounds.left}px`;
    underline.style.top = `${bottom - bounds.top + 2}px`;
    underline.style.width = `${right - left}px`;
    overlay.append(underline);
  }
  // Overlay sits beside the editor content, outside ProseMirror's document.
  const pane = marker.closest('.md-preview');
  if (!pane) return null;
  const paneBounds = pane.getBoundingClientRect();
  overlay.style.left = `${bounds.left - paneBounds.left - pane.clientLeft + pane.scrollLeft}px`;
  overlay.style.top = `${bounds.top - paneBounds.top - pane.clientTop + pane.scrollTop}px`;
  pane.append(overlay);
  return overlay;
}

export function jumpToFootnote(target, back) {
  const window = target.ownerDocument.defaultView;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'center' });
  const marker = back ? target : target.closest('li, dl[data-type="footnote_definition"]') || target;
  const attribute = 'data-footnote-jump';
  highlights.get(marker)?.();
  marker.setAttribute(attribute, back ? 'reference' : 'definition');
  const overlay = back ? null : underlineFootnote(marker);
  const clear = () => {
    marker.removeAttribute(attribute);
    marker.removeAttribute('data-footnote-leaving');
    overlay?.remove();
    highlights.delete(marker);
    window.clearTimeout(timer);
  };
  let timer = window.setTimeout(() => {
    if (back || reducedMotion) {
      clear();
      return;
    }
    marker.setAttribute('data-footnote-leaving', '');
    overlay?.setAttribute('data-footnote-leaving', '');
    timer = window.setTimeout(clear, 200);
  }, 1200);
  highlights.set(marker, clear);
}
