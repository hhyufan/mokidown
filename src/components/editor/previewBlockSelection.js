import { guardSelectedMarkdownLinks, selectionElement } from '@utils/markdownSelection';

const markerSelector = 'h1, h2, ul > li, ol > li';
const ignoredText = [
  'button',
  '[hidden]',
  '[aria-hidden="true"]',
  '.moki-markdown-marker',
  '.lang-tag',
].join(',');

function firstLabelText(element) {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      return node.data.trim() &&
        !parent.closest(ignoredText) &&
        parent.closest('h1, h2, li') === element
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  return walker.nextNode();
}

function markerBounds(range, element, viewport) {
  const text = firstLabelText(element);
  if (!text) return null;
  const start = text.data.search(/\S/);
  if (range.comparePoint(text, start) !== 0 || range.comparePoint(text, start + 1) !== 0) {
    return null;
  }
  const first = element.ownerDocument.createRange();
  first.setStart(text, start);
  first.setEnd(text, start + 1);
  const rect = first.getBoundingClientRect();
  if (!rect.height) return null;
  const window = element.ownerDocument.defaultView;
  const style = window.getComputedStyle(element);
  const fontSize = parseFloat(style.fontSize);
  let width;
  if (element.matches('h1, h2')) {
    const marker = window.getComputedStyle(element, '::before');
    width = parseFloat(marker.width) + (parseFloat(marker.marginInlineEnd) || 0);
    if (!(width > 0)) return null;
  } else {
    width =
      fontSize * (element.matches('ol > li, .task-list-item, [data-item-type="task"]') ? 2 : 1.25);
  }
  const rtl = style.direction === 'rtl';
  const edge = ((rtl ? rect.right : rect.left) - viewport.left) / viewport.scaleX;
  const left = Math.floor(rtl ? edge : edge - width);
  const right = Math.ceil(rtl ? edge + width : edge);
  const height = parseFloat(style.lineHeight) || rect.height / viewport.scaleY;
  return {
    x: left,
    y: (rect.top + rect.height / 2 - viewport.top) / viewport.scaleY - height / 2,
    width: right - left,
    height,
  };
}

function cellHighlight(cell, viewport, document) {
  const rect = cell.getBoundingClientRect();
  const style = document.defaultView.getComputedStyle(cell);
  const scroller = cell.closest('.moki-table__scroll, .md-preview__table-wrap, .tableWrapper');
  const clip = scroller?.getBoundingClientRect();
  const cellRight = rect.right - parseFloat(style.borderRightWidth) * viewport.scaleX;
  const left = Math.max(rect.left, clip?.left ?? rect.left);
  const right = Math.min(cellRight, clip?.right ?? cellRight);
  const height = rect.height / viewport.scaleY - parseFloat(style.borderBottomWidth);
  if (right <= left || height <= 0) return null;
  const highlight = document.createElement('span');
  highlight.style.left = `${(left - viewport.left) / viewport.scaleX}px`;
  highlight.style.top = `${(rect.top - viewport.top) / viewport.scaleY}px`;
  highlight.style.width = `${(right - left) / viewport.scaleX}px`;
  highlight.style.height = `${height}px`;
  if (left === rect.left) {
    highlight.style.borderTopLeftRadius = style.borderTopLeftRadius;
    highlight.style.borderBottomLeftRadius = style.borderBottomLeftRadius;
  }
  if (right === cellRight) {
    highlight.style.borderTopRightRadius = style.borderTopRightRadius;
    highlight.style.borderBottomRightRadius = style.borderBottomRightRadius;
  }
  return highlight;
}

function collectBlocks(scope, root, selector) {
  const matches = [...scope.querySelectorAll(selector)];
  for (let parent = scope; parent && parent !== root; parent = parent.parentElement) {
    if (parent.matches(selector)) matches.push(parent);
  }
  return matches;
}

function rangeCoversBlock(range, element) {
  if (!range.intersectsNode(element)) return false;
  if (!element.contains(range.startContainer) && !element.contains(range.endContainer)) return true;
  const document = element.ownerDocument;
  const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let first, last;
  while (text.nextNode()) {
    if (!text.currentNode.data.trim()) continue;
    first ??= text.currentNode;
    last = text.currentNode;
  }
  return Boolean(
    first && range.comparePoint(first, 0) === 0 && range.comparePoint(last, last.length) === 0,
  );
}

export function observePreviewBlockSelection(root, { highlightBlocks = true } = {}) {
  const document = root.ownerDocument,
    window = document.defaultView;
  let active = new Set(),
    frame;
  const markerLayer = document.createElement('div');
  markerLayer.className = 'md-preview__selection-markers';
  markerLayer.setAttribute('aria-hidden', 'true');
  const cellLayer = document.createElement('div');
  cellLayer.className = 'md-preview__selection-cells';
  cellLayer.setAttribute('aria-hidden', 'true');
  root.append(cellLayer, markerLayer);
  const restoreLinkClicks = guardSelectedMarkdownLinks(root);
  function update() {
    frame = null;
    const selection = document.getSelection(),
      next = new Set();
    const markers = document.createDocumentFragment();
    const cells = document.createDocumentFragment();
    if (selection?.rangeCount && !selection.isCollapsed) {
      const range = selection.getRangeAt(0);
      if (range.intersectsNode(root)) {
        const common = range.commonAncestorContainer;
        const element = selectionElement(common);
        const scope = root.contains(element) ? element : root;
        const box = root.getBoundingClientRect();
        const scaleX = box.width / root.offsetWidth || 1;
        const scaleY = box.height / root.offsetHeight || 1;
        const viewport = {
          left: box.left + (root.clientLeft - root.scrollLeft) * scaleX,
          top: box.top + (root.clientTop - root.scrollTop) * scaleY,
          scaleX,
          scaleY,
        };
        const startCell = selectionElement(range.startContainer)?.closest('th, td');
        const endCell = selectionElement(range.endContainer)?.closest('th, td');
        if (startCell !== endCell || !startCell) {
          for (const cell of collectBlocks(scope, root, 'table :is(th, td)')) {
            if (cell.classList.contains('selectedCell') || !range.intersectsNode(cell)) continue;
            const highlight = cellHighlight(cell, viewport, document);
            if (highlight) cells.append(highlight);
          }
        }
        for (const marker of collectBlocks(scope, root, markerSelector)) {
          if (!range.intersectsNode(marker)) continue;
          const bounds = markerBounds(range, marker, viewport);
          if (!bounds) continue;
          const highlight = document.createElement('span');
          highlight.style.left = `${bounds.x}px`;
          highlight.style.top = `${bounds.y}px`;
          highlight.style.width = `${bounds.width}px`;
          highlight.style.height = `${bounds.height}px`;
          markers.append(highlight);
        }
        if (highlightBlocks) {
          for (const block of collectBlocks(scope, root, 'blockquote, pre')) {
            const content = block.matches('pre')
              ? block.querySelector(':scope > code') || block
              : block;
            if (rangeCoversBlock(range, content))
              next.add(block.closest('.md-runnable-code') || block);
          }
        }
      }
    }
    markerLayer.replaceChildren(markers);
    cellLayer.replaceChildren(cells);
    for (const block of active) if (!next.has(block)) block.classList.remove('moki-block-selected');
    for (const block of next) if (!active.has(block)) block.classList.add('moki-block-selected');
    active = next;
  }
  const schedule = () => {
    if (frame == null) frame = window.requestAnimationFrame(update);
  };
  const scheduleNestedScroll = (event) => {
    if (event.target !== root) schedule();
  };
  document.addEventListener('selectionchange', schedule);
  root.addEventListener('scroll', scheduleNestedScroll, true);
  const resize = new ResizeObserver(schedule);
  resize.observe(root);
  schedule();
  return () => {
    document.removeEventListener('selectionchange', schedule);
    root.removeEventListener('scroll', scheduleNestedScroll, true);
    restoreLinkClicks();
    resize.disconnect();
    if (frame != null) window.cancelAnimationFrame(frame);
    for (const block of active) block.classList.remove('moki-block-selected');
    markerLayer.remove();
    cellLayer.remove();
  };
}
