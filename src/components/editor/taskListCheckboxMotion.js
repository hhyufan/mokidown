const selector = '.md-preview__task-checkbox';

export function observeTaskListCheckboxes(root) {
  const retracting = new WeakSet();
  let active = true;

  const sync = (button) => {
    if (!active || !root.contains(button) || retracting.has(button)) return;
    const next = button.getAttribute('aria-checked');
    const current = button.dataset.taskSymbol;
    if (current === next) {
      button.toggleAttribute('data-task-filled', next !== 'false');
      return;
    }

    if (current && current !== 'false') {
      const pseudo = current === 'true' ? '::before' : '::after';
      const win = button.ownerDocument.defaultView;
      // Resolve the current glyph before asking its transition to run backwards.
      win.getComputedStyle(button, pseudo).clipPath;
      button.dataset.taskSymbol = 'false';
      const motion = button.getAnimations({ subtree: true }).find((animation) =>
        animation.transitionProperty === 'clip-path' && animation.effect?.pseudoElement === pseudo);
      if (motion) {
        retracting.add(button);
        const showLatest = () => {
          retracting.delete(button);
          sync(button);
        };
        motion.finished.then(showLatest, showLatest);
        return;
      }
    }

    button.dataset.taskSymbol = next;
    button.toggleAttribute('data-task-filled', next !== 'false');
  };

  const mount = (element) => {
    if (element.nodeType !== 1) return;
    if (element.matches(selector)) sync(element);
    element.querySelectorAll(selector).forEach(sync);
  };
  mount(root);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        if (record.target.matches(selector)) sync(record.target);
      } else record.addedNodes.forEach(mount);
    }
  });
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-checked'] });
  return () => { active = false; observer.disconnect(); };
}
