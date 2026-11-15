import { installTabStripDrag } from '@/components/layout/tab-bar/tabStripDrag';
import { beginReaderFileDetachWatch, buildDragPreview, cancelReaderTabDetachWatch } from './readerWindows';
import useConfigStore from '@store/useConfigStore';
import { isSafUri, isWebPath } from '@utils/tauriApi';

export function installReaderFileDrag(container, { onMove, onRelease, onEnd, onError } = {}) {
  if (!window.__TAURI_INTERNALS__) return undefined;
  const windows = /Windows/i.test(navigator.userAgent);
  const outside = ({ x, y }) => x < 0 || y < 0 || x >= innerWidth || y >= innerHeight;
  const stop = installTabStripDrag(container, {
    nativeTracking: windows,
    selector: '[data-reader-path]',
    getId: (row) => row.dataset.readerPath,
    canDrag: (row) => !isSafUri(row.dataset.readerPath) && !isWebPath(row.dataset.readerPath),
    onDragChange: (id) => { if (!id) onEnd?.(); },
    onDropTarget: () => {},
    onGhost: (path, ghost, source, geometry) => {
      // Reuse only the file icon and name; never clone badges or row actions.
      const preview = buildDragPreview(source);
      ghost.className = 'reader-file-ghost';
      ghost.replaceChildren();
      if (preview.icon) {
        const icon = document.createElement('img');
        icon.src = preview.icon;
        icon.alt = '';
        ghost.append(icon);
      }
      const name = document.createElement('span');
      name.textContent = preview.name;
      Object.assign(name.style, { minWidth: 'max-content', flexShrink: '0', overflow: 'visible', textOverflow: 'clip' });
      ghost.append(name);
      const rowStyle = getComputedStyle(source);
      const rowBox = source.getBoundingClientRect();
      Object.assign(ghost.style, {
        width: 'max-content', minWidth: '0', maxWidth: 'none',
        height: `${rowBox.height || 36}px`, position: 'fixed', left: '0', top: '0', zIndex: '3000',
        display: 'flex', alignItems: 'center', gap: '8px', padding: '0 12px', boxSizing: 'border-box',
        margin: '0', fontFamily: rowStyle.fontFamily, fontSize: rowStyle.fontSize,
        fontWeight: rowStyle.fontWeight, lineHeight: rowStyle.lineHeight,
        background: preview.background, color: preview.color, border: `1px solid ${preview.border}`,
        borderRadius: '6px', pointerEvents: 'none', overflow: 'hidden', whiteSpace: 'nowrap',
      });
      if (ghost.firstChild?.tagName === 'IMG') Object.assign(ghost.firstChild.style, { width: '16px', height: '16px', flexShrink: '0' });
      if (!windows) {
        ghost.style.visibility = 'visible';
        return;
      }
      const shellDrop = source.dataset.readerDirectory === 'true' || useConfigStore.getState().externalFileDrag === 'explorer';
      const floating = buildDragPreview(source, preview.name, ghost, geometry);
      void beginReaderFileDetachWatch(path, preview.name, floating, shellDrop).catch((error) => {
        onError?.(error);
        window.dispatchEvent(new CustomEvent('reader:native-preview-failed', { detail: geometry.token }));
      });
    },
    onMove,
    onRelease(gesture) {
      if (outside(gesture)) return true;
      onRelease?.(gesture);
      return true;
    },
    // Windows handles drags once the pointer leaves the window.
    onDetach: () => {},
    onDragCancel: () => { if (windows) void cancelReaderTabDetachWatch().catch(console.error); },
  });
  return stop;
}
