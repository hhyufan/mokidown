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
  return Boolean(first && range.comparePoint(first, 0) === 0 && range.comparePoint(last, last.length) === 0);
}

export function observePreviewBlockSelection(root) {
  const document = root.ownerDocument, window = document.defaultView;
  let active = new Set(), frame;
  function update() {
    frame = null;
    const selection = document.getSelection(), next = new Set();
    if (selection?.rangeCount && !selection.isCollapsed) {
      const range = selection.getRangeAt(0);
      if (range.intersectsNode(root)) {
        const common = range.commonAncestorContainer;
        const element = common.nodeType === 1 ? common : common.parentElement;
        const scope = root.contains(element) ? element : root;
        const blocks = [...scope.querySelectorAll('blockquote, pre')];
        for (let parent = scope; parent && parent !== root; parent = parent.parentElement) {
          if (parent.matches('blockquote, pre')) blocks.push(parent);
        }
        for (const block of blocks) {
          const content = block.matches('pre') ? block.querySelector(':scope > code') || block : block;
          if (rangeCoversBlock(range, content)) next.add(block.closest('.md-runnable-code') || block);
        }
      }
    }
    for (const block of active) if (!next.has(block)) block.classList.remove('moki-block-selected');
    for (const block of next) if (!active.has(block)) block.classList.add('moki-block-selected');
    active = next;
  }
  const schedule = () => { if (frame == null) frame = window.requestAnimationFrame(update); };
  document.addEventListener('selectionchange', schedule);
  schedule();
  return () => {
    document.removeEventListener('selectionchange', schedule);
    if (frame != null) window.cancelAnimationFrame(frame);
    for (const block of active) block.classList.remove('moki-block-selected');
  };
}
