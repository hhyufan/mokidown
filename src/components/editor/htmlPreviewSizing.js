// Runs inside the preview document, including cross-origin loopback frames.
export const htmlPreviewSizingScript = `(() => {
  let frame = 0;
  let previous = 0;
  const measure = () => {
    frame = 0;
    const width = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0);
    if (width !== previous) {
      previous = width;
      parent.postMessage({ type: 'mokidown:html-preview-size', width }, '*');
    }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
  const observer = new ResizeObserver(schedule);
  observer.observe(document.documentElement);
  if (document.body) observer.observe(document.body);
  addEventListener('load', schedule, true);
  document.fonts?.addEventListener('loadingdone', schedule);
  schedule();
})();`;
