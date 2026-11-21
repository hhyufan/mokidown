import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

export function startContentTransition(element, update) {
  if (
    !element?.startViewTransition ||
    !element.getClientRects().length ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  ) {
    update(false);
    return null;
  }
  const transition = element.startViewTransition(() => update(true));
  // A newer selection can supersede a capture before its animations start.
  void transition.ready.catch(() => {});
  return transition;
}

export function useTransitionedView(ref, requested, enabled = true) {
  const [displayed, setDisplayed] = useState(requested);
  const committed = useRef(requested);

  useLayoutEffect(() => {
    if (committed.current === requested) return undefined;
    let current = true;
    const update = (animated) => {
      if (!current) return;
      committed.current = requested;
      if (animated) flushSync(() => setDisplayed(requested));
      else setDisplayed(requested);
    };
    const transition = startContentTransition(enabled ? ref.current : null, update);
    return () => {
      current = false;
      transition?.skipTransition();
    };
  }, [enabled, ref, requested]);

  return displayed;
}
