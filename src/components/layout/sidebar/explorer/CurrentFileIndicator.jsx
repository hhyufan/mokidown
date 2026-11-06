import { useLayoutEffect, useRef } from 'react';
import { explorerPathKey, parentDirectory } from '@utils/explorerPaths';

const transformAt = (point, scale = 1) => `translate3d(${point.x}px, ${point.y}px, 0) scaleY(${scale})`;

// One marker survives virtual row replacement and remains independent of search
// selection. Browser-composited transforms handle the entire transition.
export default function CurrentFileIndicator({ currentPath, layerRef }) {
  const element = useRef(null);
  const animation = useRef(null);
  const previous = useRef(null);
  const destination = useRef(null);
  const paintedPath = useRef('');
  const paintedParent = useRef('');
  const requestedPath = useRef('');

  useLayoutEffect(() => {
    const marker = element.current, layer = layerRef.current || marker?.parentElement;
    if (!marker || !layer) return;
    const row = !layer.hasAttribute('inert') && layer.querySelector('[aria-current="true"]');
    const icon = row && row.dataset.path === currentPath && row.querySelector('.project-tree__icon, .file-tree__item-icon');
    let next = null;
    if (icon) {
      const root = layer.getBoundingClientRect(), bounds = icon.getBoundingClientRect();
      next = { x: bounds.left - root.left - 5, y: bounds.top - root.top + (bounds.height - 14) / 2,
        path: currentPath, parent: explorerPathKey(row.dataset.directoryPath || parentDirectory(currentPath)) };
    }
    destination.current = next;
    const pathChanged = requestedPath.current !== currentPath;
    requestedPath.current = currentPath;
    const old = previous.current;
    previous.current = next;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !marker.animate;
    const stop = () => { animation.current?.cancel(); animation.current = null; };
    const snap = (point) => {
      stop(); marker.style.opacity = point ? '1' : '0';
      if (point) { marker.style.transform = transformAt(point); paintedPath.current = point.path; paintedParent.current = point.parent; }
      marker.dataset.motion = point ? 'idle' : 'hidden';
    };
    const run = (frames, duration, motion, finished, easing = 'cubic-bezier(.2,.75,.25,1)') => {
      const effect = marker.animate(frames, { duration, easing, fill: 'both' });
      animation.current = effect; marker.dataset.motion = motion;
      void effect.finished.then(() => {
        if (animation.current !== effect) return;
        animation.current = null; effect.cancel(); finished();
      }).catch(() => {});
    };
    const enter = (point) => {
      if (!point) { snap(null); return; }
      marker.style.transform = transformAt(point); marker.style.opacity = '1';
      paintedPath.current = point.path;
      paintedParent.current = point.parent;
      run([{ transform: transformAt(point, 0), opacity: 0 }, { transform: transformAt(point), opacity: 1 }], 190, 'enter', () => { marker.dataset.motion = 'idle'; });
    };

    if (reduced) { snap(next); return; }
    if (!pathChanged) {
      // Layout and scrolling follow the row without replaying file-switch motion.
      if (marker.dataset.motion === 'exit') return;
      if (!next) { snap(null); return; }
      if (!old || old.x !== next.x || old.y !== next.y) {
        if (paintedPath.current !== next.path) { stop(); enter(next); } else snap(next);
      }
      return;
    }
    const computed = getComputedStyle(marker);
    const visible = Number(computed.opacity) > .001 && paintedPath.current;
    const matrix = visible ? new DOMMatrixReadOnly(computed.transform === 'none' ? undefined : computed.transform) : null;
    // Keep both keyframes in the same transform-function list. Interpolating a
    // computed matrix into scaleY(0) can become a discrete jump because the end
    // matrix is singular; explicit scaleY parameters interpolate continuously.
    const at = matrix ? { x: matrix.m41, y: matrix.m42 } : next;
    const from = { transform: matrix ? transformAt(at, matrix.m22) : computed.transform, opacity: computed.opacity };
    stop();
    if (visible && next && paintedParent.current === next.parent) {
      marker.style.transform = transformAt(next); marker.style.opacity = '1'; paintedPath.current = next.path;
      run([from, { transform: transformAt(next), opacity: 1 }], 210, 'slide', () => { marker.dataset.motion = 'idle'; });
    } else if (visible) {
      // Scale around the vertical center while fading, with no held dot state.
      marker.style.transform = transformAt(at, 0); marker.style.opacity = '0';
      run([from, { transform: transformAt(at, 0), opacity: 0 }], 170, 'exit', () => enter(destination.current), 'cubic-bezier(.4,0,1,1)');
    } else enter(next);
  });

  useLayoutEffect(() => () => { animation.current?.cancel(); }, []);
  return <span className="file-tree__current-indicator" ref={element} aria-hidden="true" />;
}
