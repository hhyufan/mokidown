import { invoke } from '@utils/tauriInvoke';

export function afterPaint(signal) {
  return new Promise((resolve, reject) => {
    let frame;
    const stop = () => {
      cancelAnimationFrame(frame);
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    };
    const done = () => { stop(); resolve(); };
    const abort = () => { stop(); reject(new DOMException('Aborted', 'AbortError')); };
    // Hidden WebViews may throttle animation frames before reader_present.
    const timeout = setTimeout(done, 250);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(done); });
  });
}

async function animate(element, keyframes, duration, signal, retainFinal = false) {
  signal?.throwIfAborted();
  if (!element) return;
  const finish = () => { if (retainFinal) Object.assign(element.style, keyframes.at(-1)); };
  if (!element.animate || !duration) { finish(); return; }
  const animation = element.animate(keyframes, {
    duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards',
  });
  const abort = () => animation.cancel();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    await animation.finished;
    signal?.throwIfAborted();
    finish();
  } finally {
    signal?.removeEventListener('abort', abort);
    animation.cancel();
  }
  signal?.throwIfAborted();
}

export function openingClip(preview, geometry) {
  const x = geometry.offsetX;
  const y = geometry.offsetY;
  return `inset(${y}px calc(100% - ${x + preview.width}px) calc(100% - ${y + preview.height}px) ${x}px round 6px)`;
}

export async function expandReader(root, preview, geometry, signal, backgroundUrl) {
  const title = root.querySelector('.reader__title');
  const clip = openingClip(preview, geometry);
  const translation = `translate(${geometry.offsetX}px, ${geometry.offsetY}px)`;
  root.style.clipPath = clip;
  if (title) title.style.transform = translation;
  try {
    const assets = [...root.querySelectorAll('.reader__title img')].map((image) => image.decode?.().catch(() => {}));
    if (backgroundUrl) {
      const image = new Image();
      image.src = backgroundUrl;
      assets.push(image.decode?.().catch(() => {}));
    }
    await Promise.all([...assets, document.fonts?.ready]);
    // Hidden WebViews throttle rAF. Layout is already ready; do not wait for an
    // invisible paint. Keep the native card until the visible replacement paints.
    root.getBoundingClientRect();
    signal?.throwIfAborted();
    await invoke('reader_present', { focus: false });
    await afterPaint(signal);
    signal?.throwIfAborted();
    // Keep the native card until its replacement has had a chance to paint.
    await invoke('close_drag_preview', { token: preview.token });
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 300;
    await Promise.all([
      // 四边共享同一进度，右下角沿对角线拉开；正文始终保持最终尺寸。
      animate(root, [{ clipPath: clip }, { clipPath: 'inset(0px 0px 0px 0px round 0px)' }], duration, signal),
      animate(title, [{ transform: translation }, { transform: 'translate(0px, 0px)' }],
        duration, signal),
    ]);
  } finally {
    root.style.clipPath = '';
    if (title) {
      title.style.transform = '';
    }
  }
}

export async function revealReader(cover, backgroundUrl, signal) {
  if (backgroundUrl) {
    const image = new Image();
    image.src = backgroundUrl;
    await image.decode?.().catch(() => {});
  }
  await document.fonts?.ready;
  await afterPaint(signal);
  const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240;
  await animate(cover, [{ opacity: 1 }, { opacity: 0 }], duration, signal, true);
}
