import { useCallback, useEffect, useRef } from 'react';
import '@styles/markdown-jump.scss';

export const markdownJumpDuration = 4000;

export function useMarkdownJumpFeedback(documentId) {
  const pending = useRef(null);
  const clear = useCallback(() => {
    const job = pending.current;
    if (!job) return;
    cancelAnimationFrame(job.frame);
    clearTimeout(job.timer);
    job.removeHighlight?.();
    pending.current = null;
  }, []);
  useEffect(() => clear, [documentId, clear]);

  return useCallback((target, { scroll = true, className, highlight, waitForLayout = false } = {}) => {
    if (!target) return;
    clear();
    const job = {};
    pending.current = job;
    const deadline = performance.now() + 500;
    const resolve = () => typeof target === 'function' ? target() : target;
    const show = () => {
      const element = resolve();
      if (!element?.isConnected) {
        clear();
        return;
      }
      if (waitForLayout && !element.getClientRects().length) {
        // In split mode the source editor can expand a folded block after the event.
        if (performance.now() < deadline) job.frame = requestAnimationFrame(show);
        else clear();
        return;
      }
      if (highlight) {
        job.removeHighlight = highlight();
      } else {
        element.classList.add('markdown-jump-target');
        if (className) element.classList.add(className);
        job.removeHighlight = () => {
          element.classList.remove('markdown-jump-target');
          if (className) element.classList.remove(className);
        };
      }
      if (scroll) {
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        resolve()?.scrollIntoView({ behavior: reduceMotion ? 'instant' : 'smooth', block: 'center' });
      }
      job.timer = setTimeout(clear, markdownJumpDuration);
    };
    // Wait for pane layout and restored view state before scrolling.
    job.frame = requestAnimationFrame(() => {
      job.frame = requestAnimationFrame(show);
    });
  }, [clear]);
}
