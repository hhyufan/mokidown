const hiddenSelector = [
  '.md-preview__source-block[hidden]', '.moki-folded-under-heading', '.moki-folded-block',
  '.md-preview__foldable-item[data-md-collapsed="true"] > :is(ol, ul)',
  '.md-preview__foldable-code[data-md-collapsed="true"] > :not(.md-preview__fold, .md-preview__folded-code-summary)',
].join(',');

const taskItem = 'li.task-list-item, li[data-item-type="task"]';

// Keep the real editor nodes mounted throughout a fold so selections, code
// editors and nested fold states survive the drawer motion.
export function observeFoldDrawers(root) {
  const snapshots = new Map();
  const running = new Map();
  const window = root.ownerDocument.defaultView;
  const measure = (element) => {
    const style = window.getComputedStyle(element);
    return {
      height: `${element.getBoundingClientRect().height}px`,
      marginTop: style.marginTop, marginBottom: style.marginBottom,
      paddingTop: style.paddingTop, paddingBottom: style.paddingBottom,
      display: style.display,
    };
  };
  const stop = (element) => {
    const motion = running.get(element);
    if (!motion) return;
    running.delete(element);
    motion.animation.cancel();
  };
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((entries) => {
    for (const { target } of entries) {
      const snapshot = snapshots.get(target);
      if (snapshot && !snapshot.hidden && !running.has(target) && target.getClientRects().length) {
        snapshot.size = measure(target);
      }
    }
  });
  const sync = () => {
    for (const element of root.querySelectorAll(':scope > *, li > ul, li > ol, .md-preview__foldable-code > *')) {
      const hidden = element.matches(hiddenSelector);
      const previous = snapshots.get(element);
      if (!previous) {
        snapshots.set(element, { hidden, size: hidden ? null : measure(element) });
        resize?.observe(element);
        continue;
      }
      if (hidden === previous.hidden) continue;
      const hasTaskBranch = element.matches('ul, ol') && element.parentElement?.matches(taskItem)
        && element.querySelector(taskItem);
      const current = running.has(element) ? measure(element) : null;
      const currentClip = current && hasTaskBranch ? window.getComputedStyle(element).clipPath : null;
      stop(element);
      const size = hidden ? previous.size : measure(element);
      previous.hidden = hidden;
      if (!hidden) previous.size = size;
      if (!size || size.display === 'none' || !element.animate
        || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) continue;
      const { display: _display, ...expanded } = size;
      const closed = { height: '0px', marginTop: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px' };
      const { display: _currentDisplay, ...interrupted } = current || {};
      const from = current ? interrupted : hidden ? expanded : closed;
      // Animation-only styles do not produce DOM mutations. Inline style changes
      // make ProseMirror reparse and replace the list, cancelling its animation.
      const frame = (geometry, atClosed, clipPath) => ({
        ...geometry,
        display: size.display,
        minHeight: '0px',
        boxSizing: 'border-box',
        ...(hasTaskBranch ? {
          // The branch rises above the list to reach the parent's checkbox.
          // Include that space in the clip and close it from the bottom.
          overflow: 'visible',
          clipPath: clipPath || `inset(calc(-.5lh - ${geometry.marginTop}) -4em ${atClosed ? '.5lh' : '0px'} -4em)`,
        } : { overflow: 'clip' }),
      });
      const animation = element.animate([
        frame(from, !current && !hidden, currentClip),
        frame(hidden ? closed : expanded, hidden),
      ], {
        duration: 280, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'both',
      });
      running.set(element, { animation });
      animation.onfinish = () => {
        if (running.get(element)?.animation !== animation) return;
        stop(element);
        if (!hidden) previous.size = measure(element);
      };
    }
    for (const element of snapshots.keys()) {
      if (root.contains(element)) continue;
      stop(element);
      resize?.unobserve(element);
      snapshots.delete(element);
    }
  };
  sync();
  const mutations = new MutationObserver(sync);
  mutations.observe(root, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['hidden', 'class', 'data-md-collapsed'] });
  return () => {
    mutations.disconnect();
    resize?.disconnect();
    for (const element of running.keys()) stop(element);
    snapshots.clear();
  };
}
