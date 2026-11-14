export function clearFoldAnimations(pending) {
  for (const timer of pending.values()) clearTimeout(timer);
  pending.clear();
}

export function updateFoldControl(button, collapsed, enabled, label, pending) {
  const before = button.getAttribute('aria-expanded');
  const changed = before != null && before !== String(!collapsed);
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-expanded', String(!collapsed));
  button.title = label;
  const reduced = button.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if (changed && !reduced) {
    clearTimeout(pending.get(button));
    button.hidden = false;
    button.classList.add('md-preview__fold--rotating');
    button.dataset.foldMotion = collapsed ? 'collapse' : 'expand';
    pending.set(button, setTimeout(() => {
      pending.delete(button);
      button.classList.remove('md-preview__fold--rotating');
      delete button.dataset.foldMotion;
      button.hidden = !enabled && button.getAttribute('aria-expanded') === 'true';
    }, 160));
  } else if (enabled || collapsed || reduced) {
    clearTimeout(pending.get(button));
    pending.delete(button);
    button.classList.remove('md-preview__fold--rotating');
    delete button.dataset.foldMotion;
    button.hidden = !enabled && !collapsed;
  } else if (!pending.has(button)) {
    button.hidden = true;
  }
}
