const svgNamespace = 'http://www.w3.org/2000/svg';
const selector = '.md-preview__task-strike';
const strikeHighlight = 'moki-task-struck';
const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

function visualLine(lines, center, lineHeight) {
  return lines.find((line) => Math.abs(line.center - center) < lineHeight / 2);
}

function linesForLabel(label, lineHeight) {
  const range = label.ownerDocument.createRange();
  const lines = [];
  const text = [];
  const addRects = (rects) => {
    for (const rect of rects) {
      if (!rect.width || !rect.height) continue;
      const y = (rect.top + rect.bottom) / 2;
      const line = visualLine(lines, y, lineHeight);
      if (line) {
        line.left = Math.min(line.left, rect.left);
        line.right = Math.max(line.right, rect.right);
      } else lines.push({ left: rect.left, right: rect.right, center: y });
    }
  };
  const collect = (node, hasBounds = false) => {
    if (node.nodeType === 3) {
      if (node.length) text.push(node);
      if (!hasBounds) {
        range.selectNodeContents(node);
        addRects(range.getClientRects());
      }
      return;
    }
    if (node.nodeType !== 1 || node.matches('button, .ProseMirror-widget')) return;
    // Code chips contribute their entire width, including the padding around the text.
    const hasOwnBounds = node.matches('code, img, [contenteditable="false"]');
    if (!hasBounds && hasOwnBounds) addRects(node.getClientRects());
    for (const child of node.childNodes) collect(child, hasBounds || hasOwnBounds);
  };
  for (const child of label.childNodes) collect(child);
  return { lines, text, lineHeight };
}

function glyphsForText({ lines, text, lineHeight }) {
  return text.map((node) => {
    const range = node.ownerDocument.createRange();
    const glyphs = [];
    const segments = graphemes ? graphemes.segment(node.data) : Array.from(node.data, (segment) => ({ segment }));
    let start = 0;
    for (const { segment } of segments) {
      const end = start + segment.length;
      range.setStart(node, start);
      range.setEnd(node, end);
      const rect = range.getClientRects()[0];
      if (rect?.width) {
        const line = visualLine(lines, rect.top + rect.height / 2, lineHeight);
        if (line) glyphs.push({ start, end, right: rect.right, line });
      }
      start = end;
    }
    return { node, glyphs };
  });
}

function coveredText(entry, progress) {
  if (progress <= 0) return [];
  if (progress >= 1) return entry.geometry.text.map((node) => ({ node, start: 0, end: node.length }));
  entry.glyphs ??= glyphsForText(entry.geometry);
  const ranges = [];
  for (const { node, glyphs } of entry.glyphs) {
    for (const { start, end, right, line } of glyphs) {
      if (end > node.length || right > line.left + progress * (line.right - line.left) + 0.1) continue;
      const previous = ranges.at(-1);
      if (previous?.node === node && previous.end === start) previous.end = end;
      else ranges.push({ node, start, end });
    }
  }
  return ranges;
}

function applyTextRanges(highlight, entry, ranges) {
  if (ranges.length === entry.ranges.length && ranges.every(({ node, start, end }, index) => {
    const previous = entry.ranges[index];
    return previous.startContainer === node && previous.startOffset === start
      && previous.endContainer === node && previous.endOffset === end;
  })) return;
  entry.ranges.forEach((range) => highlight.delete(range));
  entry.ranges = ranges.map(({ node, start, end }) => {
    const range = node.ownerDocument.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    highlight.add(range);
    return range;
  });
}

// Draw above inline backgrounds, across each visual line. Keep the same paths
// on check/uncheck so the transition can run in either direction or reverse mid-flight.
export function observeTaskListStrikes(root) {
  const { defaultView: win } = root.ownerDocument;
  const registry = win.CSS?.highlights;
  const highlight = registry && typeof win.Highlight === 'function'
    ? registry.get(strikeHighlight) || new win.Highlight() : null;
  if (highlight && !registry.has(strikeHighlight)) registry.set(strikeHighlight, highlight);
  const entries = new Map();
  const animating = new Set();
  let frame = 0;
  let paintFrame = 0;

  const paintText = (svg, entry) => {
    const target = svg.dataset.drawn === 'true' ? 1 : 0;
    const remaining = parseFloat(win.getComputedStyle(svg).strokeDashoffset);
    const progress = Number.isFinite(remaining) ? Math.max(0, Math.min(1, 1 - remaining)) : target;
    applyTextRanges(highlight, entry, coveredText(entry, progress));
    if (progress === target) {
      entry.glyphs = null;
      animating.delete(svg);
    } else animating.add(svg);
  };
  const paint = () => {
    paintFrame = 0;
    for (const svg of animating) paintText(svg, entries.get(svg));
    if (animating.size) paintFrame = win.requestAnimationFrame(paint);
  };

  const update = () => {
    frame = 0;
    const overlays = [...root.querySelectorAll(selector)].map((svg) => {
      const row = svg.closest('li[data-task-state]');
      const checked = row?.dataset.taskState === 'true';
      if (!checked && svg.dataset.drawn === 'false' && !animating.has(svg)) return null;
      const label = row?.querySelector(':scope > .md-preview__task-label, :scope > p');
      if (!label) return null;
      const { x, y, width, height } = svg.getBoundingClientRect();
      if (!width || !height) return null;
      const lineHeight = parseFloat(win.getComputedStyle(label).lineHeight) || 24;
      const geometry = checked || svg.childElementCount
        ? linesForLabel(label, lineHeight * height) : { lines: [], text: [] };
      const paths = geometry.lines.map(({ left, right, center }) => {
        const top = (center - y) / height;
        return `M${(left - x) / width} ${top}H${(right - x) / width}`;
      });
      return { svg, checked, paths, geometry };
    });
    const visible = new Set(overlays.filter(Boolean).map(({ svg }) => svg));
    for (const [svg, entry] of entries) {
      if (visible.has(svg)) continue;
      applyTextRanges(highlight, entry, []);
      entries.delete(svg);
      animating.delete(svg);
    }
    const textUpdates = [];
    for (const item of overlays) {
      if (!item) continue;
      const { svg, checked, paths, geometry } = item;
      while (svg.childElementCount > paths.length) svg.lastElementChild.remove();
      paths.forEach((data, index) => {
        let path = svg.children[index];
        if (!path) {
          path = root.ownerDocument.createElementNS(svgNamespace, 'path');
          path.setAttribute('pathLength', '1');
          svg.append(path);
        }
        if (path.getAttribute('d') !== data) path.setAttribute('d', data);
      });
      const drawn = String(checked);
      if (svg.dataset.drawn !== drawn) {
        if (svg.hasAttribute('data-drawn')) {
          // Resolve the starting dash offset when the first path was just created.
          win.getComputedStyle(svg).strokeDashoffset;
          svg.dataset.animate = '';
        }
        svg.dataset.drawn = drawn;
      }
      if (highlight) {
        const entry = entries.get(svg) || { ranges: [] };
        entry.geometry = geometry;
        entry.glyphs = null;
        entries.set(svg, entry);
        textUpdates.push([svg, entry]);
      }
    }
    for (const [svg, entry] of textUpdates) paintText(svg, entry);
    if (animating.size && !paintFrame) paintFrame = win.requestAnimationFrame(paint);
  };
  const schedule = () => { if (!frame) frame = win.requestAnimationFrame(update); };
  const observer = new MutationObserver((records) => {
    if (records.some(({ target, attributeName }) => target.nodeType !== 1
      || (!target.closest(selector) && !(attributeName === 'style' && target.matches('.md-preview__task-checkbox'))))) schedule();
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['data-task-state', 'data-md-collapsed', 'hidden', 'class', 'style'] });
  const resize = new ResizeObserver(schedule);
  resize.observe(root);
  root.ownerDocument.fonts?.addEventListener('loadingdone', schedule);
  root.addEventListener('load', schedule, true);
  update();
  return () => {
    observer.disconnect();
    resize.disconnect();
    root.ownerDocument.fonts?.removeEventListener('loadingdone', schedule);
    root.removeEventListener('load', schedule, true);
    if (frame) win.cancelAnimationFrame(frame);
    if (paintFrame) win.cancelAnimationFrame(paintFrame);
    for (const entry of entries.values()) applyTextRanges(highlight, entry, []);
  };
}
