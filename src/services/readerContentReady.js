import { afterPaint } from './readerOpening';

// Wait for the initial visible document, not offscreen lazy media. Broken or slow
// network assets must not leave a perfectly readable document behind a cover.
export async function waitForReaderContent(root, signal, timeoutMs = 5000) {
  signal?.throwIfAborted();
  let expired = false;
  const visible = (element) => {
    const box = element.getBoundingClientRect();
    const viewport = root.getBoundingClientRect();
    return box.bottom >= viewport.top && box.top <= viewport.bottom;
  };
  const settled = async () => {
    while (!expired && [...root.querySelectorAll('[data-reader-pending]')].some(visible)) {
      await new Promise((resolve) => {
        const observer = new MutationObserver(done);
        const timer = setTimeout(done, 100);
        function done() { clearTimeout(timer); observer.disconnect(); resolve(); }
        observer.observe(root, { subtree: true, childList: true, attributes: true });
      });
      signal?.throwIfAborted();
    }
    if (expired) return;
    await Promise.all([...root.querySelectorAll('img')].filter(visible).map(async (image) => {
      image.loading = 'eager';
      await image.decode?.().catch(() => {});
    }));
    await document.fonts?.ready;
  };
  let timeout;
  try {
    await Promise.race([
      settled(),
      new Promise((resolve) => { timeout = setTimeout(() => { expired = true; resolve(); }, timeoutMs); }),
    ]);
    signal?.throwIfAborted();
    // Pre-rendering needs completed layout, not a throttled hidden-window frame.
    // The handoff confirms visible painting separately before removing the card.
    if (document.hidden) root.getBoundingClientRect();
    else await afterPaint(signal);
  } finally { expired = true; clearTimeout(timeout); }
}
