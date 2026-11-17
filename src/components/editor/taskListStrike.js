const svgNamespace = 'http://www.w3.org/2000/svg';
const selector = '.md-preview__task-strike';

function linesForLabel(label, lineHeight) {
  const range = label.ownerDocument.createRange();
  const lines = [];
  const collect = (node) => {
    let rects;
    if (node.nodeType === 3) {
      range.selectNodeContents(node);
      rects = range.getClientRects();
    } else if (node.nodeType === 1) {
      if (node.matches('button, .ProseMirror-widget')) return;
      // Take the full code chip, including its padding, instead of its glyphs.
      if (node.matches('code, img, [contenteditable="false"]')) rects = node.getClientRects();
      else for (const child of node.childNodes) collect(child);
    }
    for (const rect of rects || []) {
      if (!rect.width || !rect.height) continue;
      const y = (rect.top + rect.bottom) / 2;
      const line = lines.find((line) => Math.abs(line.center - y) < lineHeight / 2);
      if (line) {
        line.left = Math.min(line.left, rect.left);
        line.right = Math.max(line.right, rect.right);
      } else lines.push({ left: rect.left, right: rect.right, center: y });
    }
  };
  for (const child of label.childNodes) collect(child);
  return lines;
}

// Draw above inline backgrounds, across each visual line. Keep the same paths
// on check/uncheck so the transition can run in either direction or reverse mid-flight.
export function observeTaskListStrikes(root) {
  const { defaultView: win } = root.ownerDocument;
  let frame = 0;
  const update = () => {
    frame = 0;
    const overlays = [...root.querySelectorAll(selector)].map((svg) => {
      const row = svg.closest('li[data-task-state]');
      const checked = row?.dataset.taskState === 'true';
      if (!checked && !svg.childElementCount && svg.dataset.drawn === 'false') return null;
      const label = row?.querySelector(':scope > .md-preview__task-label, :scope > p');
      if (!label) return null;
      const { x, y, width, height } = svg.getBoundingClientRect();
      if (!width || !height) return null;
      const lineHeight = parseFloat(win.getComputedStyle(label).lineHeight) || 24;
      const lines = checked || svg.childElementCount ? linesForLabel(label, lineHeight * height) : [];
      const paths = lines.map(({ left, right, center }) => {
        const top = (center - y) / height;
        return `M${(left - x) / width} ${top}H${(right - x) / width}`;
      });
      return { svg, checked, paths };
    });
    for (const item of overlays) {
      if (!item) continue;
      const { svg, checked, paths } = item;
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
        if (checked) svg.dataset.dimmed = '';
        else if (svg.hasAttribute('data-dimmed')) {
          const retraction = svg.getAnimations().find((animation) => animation.transitionProperty === 'stroke-dashoffset');
          const restoreColor = () => {
            if (svg.dataset.drawn === 'false') delete svg.dataset.dimmed;
          };
          if (retraction) retraction.finished.then(restoreColor, restoreColor);
          else restoreColor();
        }
      }
    }
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
  };
}
