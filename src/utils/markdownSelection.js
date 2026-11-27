export const renderedMarkdownHtml =
  '.md-preview__html-block-preview, span[data-type="html"].md-preview__html';

export function selectedRange(root) {
  const selection = root?.ownerDocument.getSelection();
  if (
    !selection?.rangeCount ||
    selection.isCollapsed ||
    !root.contains(selection.anchorNode) ||
    !root.contains(selection.focusNode)
  )
    return null;
  return selection.getRangeAt(0);
}

export function selectionElement(node) {
  return node?.nodeType === 1 ? node : node?.parentElement;
}

export function selectedMarkdownHtml(root, range = selectedRange(root)) {
  if (!range) return null;
  const scope = selectionElement(range.commonAncestorContainer);
  const html = scope.closest(renderedMarkdownHtml);
  if (html && root.contains(html)) return { root: html, range };
  return [...scope.querySelectorAll(renderedMarkdownHtml)].some((element) =>
    range.intersectsNode(element),
  )
    ? { root, range }
    : null;
}

/** Keep the browser selection independent of ProseMirror's atomic HTML node. */
export function enableRenderedHtmlDragSelection(root) {
  const document = root.ownerDocument;
  const window = document.defaultView;
  const lifetime = new AbortController();
  const { signal } = lifetime;
  let gesture = null;
  let suppressClick = false;
  let releaseFrame;

  const pointAt = (event, container) => {
    const hit = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    if (hit && container.contains(hit.startContainer)) {
      return { node: hit.startContainer, offset: hit.startOffset };
    }
    const element = document.elementFromPoint(event.clientX, event.clientY);
    if (!element || !container.contains(element)) return null;
    const rect = element.getBoundingClientRect();
    const after = event.clientX > (rect.left + rect.right) / 2;
    if (element.matches('img, svg, hr') && container.contains(element.parentNode)) {
      return {
        node: element.parentNode,
        offset:
          Array.prototype.indexOf.call(element.parentNode.childNodes, element) + Number(after),
      };
    }
    return { node: element, offset: after ? element.childNodes.length : 0 };
  };

  const update = (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    if (!gesture.dragging && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 3)
      return;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const hoveredHtml = target?.closest(renderedMarkdownHtml);
    if (!gesture.preview) {
      const selection = document.getSelection();
      const range = selectedRange(root);
      const crossed = range && selectedMarkdownHtml(root, range);
      const preview =
        hoveredHtml ||
        (crossed &&
          Array.from(root.querySelectorAll(renderedMarkdownHtml)).find((element) =>
            range.intersectsNode(element),
          ));
      if (!preview || !root.contains(preview)) return;
      if (range) gesture.start = { node: selection.anchorNode, offset: selection.anchorOffset };
      // The drag may enter an HTML atom from regular Markdown in either direction.
      // Move focus off the editing host before it normalizes the HTML endpoint.
      gesture.preview = preview;
      preview.focus({ preventScroll: true });
    }
    const end = (hoveredHtml && pointAt(event, hoveredHtml)) || pointAt(event, root);
    if (!end || !root.contains(end.node) || !root.contains(gesture.start.node)) return;
    gesture.dragging = true;
    gesture.end = end;
    document
      .getSelection()
      .setBaseAndExtent(gesture.start.node, gesture.start.offset, end.node, end.offset);
  };

  const begin = (event) => {
    window.cancelAnimationFrame(releaseFrame);
    gesture = null;
    suppressClick = false;
    if (event.button !== 0 || event.pointerType === 'touch') return;
    const target = selectionElement(event.target);
    if (!target || target.closest('input, textarea, select, button, video, audio, .cm-editor'))
      return;
    const preview = target?.closest(renderedMarkdownHtml);
    const start = pointAt(event, preview || root);
    if (!start) return;
    const selection = document.getSelection();
    const anchor =
      event.shiftKey && root.contains(selection.anchorNode)
        ? { node: selection.anchorNode, offset: selection.anchorOffset }
        : start;
    gesture = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      start: anchor,
      preview,
      dragging: false,
    };
    if (!preview) return;
    preview.focus({ preventScroll: true });
    // Cancel the compatibility mouse events that would let the outer editor
    // replace the HTML range on release.
    event.preventDefault();
    if (event.shiftKey) {
      gesture.dragging = true;
      update(event);
    } else {
      selection.collapse(start.node, start.offset);
    }
  };

  root.addEventListener('pointerdown', begin, { capture: true, signal });
  window.addEventListener('pointermove', update, { capture: true, signal });
  window.addEventListener(
    'pointerup',
    (event) => {
      if (event.pointerId !== gesture?.id) return;
      update(event);
      const { dragging, start, end, preview } = gesture;
      suppressClick = dragging;
      gesture = null;
      if (!dragging || !end) return;
      releaseFrame = window.requestAnimationFrame(() => {
        const selection = document.getSelection();
        if (
          !root.contains(start.node) ||
          !root.contains(end.node) ||
          !root.contains(document.activeElement)
        )
          return;
        if (
          selection.anchorNode === start.node &&
          selection.anchorOffset === start.offset &&
          selection.focusNode === end.node &&
          selection.focusOffset === end.offset
        )
          return;
        preview.focus({ preventScroll: true });
        selection.setBaseAndExtent(start.node, start.offset, end.node, end.offset);
      });
    },
    { capture: true, signal },
  );
  window.addEventListener(
    'pointercancel',
    () => {
      gesture = null;
    },
    { signal },
  );
  root.addEventListener(
    'click',
    (event) => {
      if (!suppressClick || event.detail === 0) return;
      suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    { capture: true, signal },
  );
  return () => {
    lifetime.abort();
    window.cancelAnimationFrame(releaseFrame);
  };
}

export function guardSelectedMarkdownLinks(root) {
  let selectedAtPointerDown;
  const findLink = (event) => selectionElement(event.target)?.closest('a[href]');
  const selectionIncludes = (link) => Boolean(link && selectedRange(root)?.intersectsNode(link));
  const rememberLink = (event) => {
    const link = findLink(event);
    selectedAtPointerDown = selectionIncludes(link) ? link : null;
  };
  const guardClick = (event) => {
    const link = findLink(event);
    if (!link) return;
    if (selectionIncludes(link) || (event.detail > 0 && link === selectedAtPointerDown)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    selectedAtPointerDown = null;
  };
  root.addEventListener('pointerdown', rememberLink, true);
  root.addEventListener('click', guardClick, true);
  root.addEventListener('auxclick', guardClick, true);
  return () => {
    root.removeEventListener('pointerdown', rememberLink, true);
    root.removeEventListener('click', guardClick, true);
    root.removeEventListener('auxclick', guardClick, true);
  };
}
