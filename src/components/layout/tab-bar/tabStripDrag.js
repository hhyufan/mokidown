// 使用指针事件，避免 Windows WebView 的原生文件拖放接管 HTML drag/drop。
export function installTabStripDrag(container, { onDragChange, onDropTarget, onReorder, onDetach, onDragCancel,
  selector = '[data-tab-id]', getId = (element) => element.dataset.tabId, onGhost, nativeTracking = false }) {
  let gesture = null;
  let frame = null;
  let ghost = null;
  let suppressClick = false;
  const eventElement = (event) => typeof event.target?.closest === 'function'
    ? event.target : event.target?.parentElement;

  const placeGhost = () => {
    if (!ghost || !gesture) return;
    ghost.style.transform = `translate3d(${gesture.x - gesture.offsetX}px, ${gesture.y - gesture.offsetY}px, 0)`;
  };
  // 拖拽跟手浮层：克隆原标签节点，让文件类型图标、名称与配色保持完全一致。
  const startGhost = () => {
    const source = gesture.source;
    if (!source) return;
    const node = source.cloneNode(true);
    node.removeAttribute('data-tab-id');
    node.removeAttribute('data-reader-path');
    node.removeAttribute('id');
    node.classList.remove('tabbar__tab--dragging', 'tabbar__tab--drop-before', 'tabbar__tab--drop-after', 'tabbar__tab--renaming');
    node.classList.add('tabbar__tab-ghost');
    for (const extra of node.querySelectorAll('input, button, .tabbar__tab-close, .sidebar__recent-del, .sidebar__recent-bookmark')) extra.remove();
    const sourceStyle = getComputedStyle(source);
    Object.assign(node.style, {
      width: 'max-content', minWidth: `${source.offsetWidth}px`, maxWidth: 'none',
      height: `${source.offsetHeight}px`, boxSizing: 'border-box',
      fontFamily: sourceStyle.fontFamily, fontSize: sourceStyle.fontSize, lineHeight: sourceStyle.lineHeight,
    });
    ghost = node;
    document.body.appendChild(node);
    for (const label of node.querySelectorAll('.tabbar__tab-name')) {
      Object.assign(label.style, {
        width: 'max-content', minWidth: 'max-content', maxWidth: 'none',
        overflow: 'visible', textOverflow: 'clip', whiteSpace: 'nowrap', flexShrink: '0',
      });
    }
    // Native drags have exactly one visible surface, even before it straddles the edge.
    if (nativeTracking) node.style.visibility = 'hidden';
    placeGhost();
    node.dataset.previewToken = crypto.randomUUID();
    onGhost?.(gesture.id, node, source, {
      token: node.dataset.previewToken, offsetX: gesture.offsetX, offsetY: gesture.offsetY,
    });
  };
  const clearGhost = () => {
    ghost?.remove();
    ghost = null;
  };

  const locate = () => {
    if (!onReorder) return null;
    const strip = container.getBoundingClientRect();
    if (onDetach && (
      gesture.x < strip.left - 24 || gesture.x > strip.right + 24
      || gesture.y < strip.top - 24 || gesture.y > strip.bottom + 24
    )) return null;
    const tabs = [...container.querySelectorAll('[data-tab-id]')];
    const target = tabs.find((tab) => gesture.x < tab.getBoundingClientRect().right) || tabs.at(-1);
    if (!target) return null;
    const box = target.getBoundingClientRect();
    return { id: target.dataset.tabId, after: gesture.x > box.left + box.width / 2 };
  };
  const tick = () => {
    if (!gesture?.dragging) return;
    const box = container.getBoundingClientRect();
    const speed = gesture.x < box.left + 32 ? -10 : gesture.x > box.right - 32 ? 10 : 0;
    if (speed && onReorder) container.scrollBy({ left: speed, behavior: 'instant' });
    gesture.target = locate();
    // 拖出标签栏时浮层提示「释放即新建阅读窗口」，与窗口内换位区分开。
    if (!nativeTracking) ghost?.classList.toggle('tabbar__tab-ghost--out', Boolean(onDetach) && !gesture.target);
    onDropTarget(gesture.target);
    frame = requestAnimationFrame(tick);
  };
  const finish = (commit, forceDetach = false, nativeDone = false) => {
    if (!gesture) return;
    const current = gesture;
    gesture = null;
    cancelAnimationFrame(frame);
    clearGhost();
    if (container.hasPointerCapture?.(current.pointerId)) container.releasePointerCapture(current.pointerId);
    if (!current.dragging) return;
    suppressClick = true;
    if (!commit && !nativeDone) onDragCancel?.(current.id);
    if (commit && !forceDetach && current.target) onReorder(current.id, current.target.id, current.target.after);
    else if (commit && onDetach) onDetach(current.id, { screenX: current.screenX, screenY: current.screenY });
    onDragChange(null);
    onDropTarget(null);
  };
  const down = (event) => {
    suppressClick = false;
    if (gesture || event.button !== 0 || event.isPrimary === false) return;
    const target = eventElement(event);
    if (!target) return;
    if (target.closest('input, button, .tabbar__tab-close, .tabbar__tab--renaming, .sidebar__recent-del')) return;
    const tab = target.closest(selector);
    if (!tab || !container.contains(tab)) return;
    const box = tab.getBoundingClientRect();
    gesture = { id: getId(tab), source: tab, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY, screenX: event.screenX, screenY: event.screenY, dragging: false,
      offsetX: event.clientX - (Number.isFinite(box.left) ? box.left : event.clientX),
      offsetY: event.clientY - (Number.isFinite(box.top) ? box.top : event.clientY) };
  };
  const move = (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    gesture.screenX = event.screenX;
    gesture.screenY = event.screenY;
    if (!gesture.dragging && Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) >= 6) {
      gesture.dragging = true;
      container.setPointerCapture?.(event.pointerId);
      startGhost();
      onDragChange(gesture.id);
      tick();
    }
    if (gesture.dragging) {
      event.preventDefault();
      placeGhost();
      gesture.target = locate();
      onDropTarget(gesture.target);
    }
  };
  const up = (event) => {
    if (event.pointerId !== gesture?.pointerId) return;
    if (gesture.dragging) {
      gesture.x = event.clientX;
      gesture.y = event.clientY;
      gesture.screenX = event.screenX;
      gesture.screenY = event.screenY;
      gesture.target = locate();
      event.preventDefault();
    }
    finish(true);
  };
  const cancel = () => finish(false);
  const lostCapture = () => {
    if (gesture?.dragging && nativeTracking) return;
    if (gesture?.dragging && onDetach) finish(true, true);
    else cancel();
  };
  const blur = () => {
    if (gesture?.dragging && nativeTracking) return;
    if (gesture?.dragging && onDetach) finish(true, true);
    else cancel();
  };
  const key = (event) => {
    if (event.key !== 'Escape') return;
    cancel();
  };
  const click = (event) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const nativeEnd = (event) => {
    if (ghost?.dataset.previewToken === event.detail) finish(false, false, true);
  };
  const nativeFailed = (event) => {
    if (ghost?.dataset.previewToken === event.detail) ghost.style.visibility = 'visible';
  };
  const nativeDrag = (event) => {
    if (eventElement(event)?.closest(selector)) event.preventDefault();
  };
  const listeners = { pointerdown: down, pointercancel: cancel, lostpointercapture: lostCapture, dragstart: nativeDrag };
  for (const [type, handler] of Object.entries(listeners)) container.addEventListener(type, handler);
  container.addEventListener('click', click, true);
  window.addEventListener('keydown', key);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('blur', blur);
  window.addEventListener('reader:native-drag-end', nativeEnd);
  window.addEventListener('reader:native-preview-failed', nativeFailed);
  return () => {
    cancel();
    for (const [type, handler] of Object.entries(listeners)) container.removeEventListener(type, handler);
    container.removeEventListener('click', click, true);
    window.removeEventListener('keydown', key);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('blur', blur);
    window.removeEventListener('reader:native-drag-end', nativeEnd);
    window.removeEventListener('reader:native-preview-failed', nativeFailed);
  };
}
