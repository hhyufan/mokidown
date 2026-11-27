const EDGE = 8;
const GAP = 6;
const SCROLL_SPACE = '--editor-popup-space';

export function markdownPopupScroller(element) {
  return element.closest('.history-markdown-draft') ?? element.closest('.md-preview');
}

export function editorPopupBounds(window, area) {
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0;
  const top = viewport?.offsetTop ?? 0;
  const right = left + (viewport?.width ?? window.innerWidth);
  const bottom = top + (viewport?.height ?? window.innerHeight);
  return {
    left: Math.max(left, area?.left ?? left),
    top: Math.max(top, area?.top ?? top),
    right: Math.min(right, area?.right ?? right),
    bottom: Math.min(bottom, area?.bottom ?? bottom),
  };
}

export function editorPopupRoomBelow(bounds, anchor) {
  return bounds.bottom - anchor.bottom - GAP - EDGE;
}

export function placeEditorPopup(bounds, anchor, width, height, preferred = 'below') {
  const below = Math.max(0, editorPopupRoomBelow(bounds, anchor));
  const above = Math.max(0, anchor.top - bounds.top - GAP - EDGE);
  const room = preferred === 'below' ? below : above;
  const other = preferred === 'below' ? above : below;
  const placement = room >= height || room >= other
    ? preferred
    : preferred === 'below' ? 'above' : 'below';
  const maxHeight = placement === 'below' ? below : above;
  const maxWidth = Math.max(0, bounds.right - bounds.left - 2 * EDGE);
  return {
    placement,
    maxHeight,
    maxWidth,
    left: Math.max(bounds.left + EDGE, Math.min(anchor.left, bounds.right - EDGE - Math.min(width, maxWidth))),
    top: placement === 'below' ? anchor.bottom + GAP : anchor.top - GAP - Math.min(height, maxHeight),
  };
}

export function makeEditorPopupRoom(scroller, distance) {
  if (distance <= 1) return;
  const available = Math.max(0, scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop);
  if (distance > available) {
    const reserved = parseFloat(scroller.style.getPropertyValue(SCROLL_SPACE)) || 0;
    scroller.style.setProperty(SCROLL_SPACE, `${reserved + Math.ceil(distance - available)}px`);
  }
  scroller.scrollTop += distance;
}

export function clearEditorPopupRoom(scroller) {
  scroller.style.removeProperty(SCROLL_SPACE);
}
