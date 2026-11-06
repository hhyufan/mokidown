import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { FAST_FILE_SCROLL_SPEED, FILE_ROW_HEIGHT, FILE_SCROLL_IDLE_MS, fileWindow } from '@utils/virtualFileWindow';
import './virtual-file-list.scss';
import CurrentFileIndicator from './CurrentFileIndicator';

export default function VirtualFileList({ count, renderRow, onRangeChange, isRowReady, pinnedIndex = -1, dataVersion, role = 'list', ariaLabel, scrollTarget, resetKey, footer = null, currentFilePath = '' }) {
  const element = useRef(null);
  const viewportLayer = useRef(null);
  const rowLayer = useRef(null);
  const [viewport, setViewport] = useState(320);
  const [motion, setMotion] = useState({ offset: 0, velocity: 0 });
  const [contentWidth, setContentWidth] = useState(0);
  const footerHeight = footer ? FILE_ROW_HEIGHT : 0;
  const windowState = fileWindow(count, viewport, motion.offset, FILE_ROW_HEIGHT, motion.velocity, footerHeight);
  const latest = useRef(windowState);
  latest.current = windowState;
  const logicalOffset = useRef(0);
  const frame = useRef(null);
  const idleTimer = useRef(null);
  const lastPaint = useRef({ offset: 0, time: performance.now() });
  const expectedScroll = useRef(null);
  const previousReset = useRef(resetKey);
  const resident = useRef(null);
  const revealed = useRef(null);
  const widthScope = useRef({ count, resetKey, dataVersion, viewportWidth: 0 });

  useLayoutEffect(() => {
    if (previousReset.current === resetKey) return;
    previousReset.current = resetKey;
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = null;
    clearTimeout(idleTimer.current);
    logicalOffset.current = 0;
    expectedScroll.current = 0;
    element.current.scrollTop = 0;
    lastPaint.current = { offset: 0, time: performance.now() };
    resident.current = null;
    revealed.current = null;
    element.current.scrollLeft = 0;
    setContentWidth(0);
    setMotion({ offset: 0, velocity: 0 });
  }, [resetKey]);

  const moveTo = useCallback((requestedOffset, syncScroll = true) => {
    const current = latest.current;
    const next = Math.max(0, Math.min(requestedOffset, current.logicalMax));
    if (next === logicalOffset.current) return;
    logicalOffset.current = next;
    // Move resident rows immediately and let the next frame fill the rest;
    // no loading surface (skeleton) is shown for jumps or fast wheel input.
    const painted = resident.current?.geometry || current;
    const covered = next >= painted.start * FILE_ROW_HEIGHT && next + current.viewport <= painted.end * FILE_ROW_HEIGHT;
    if (rowLayer.current) rowLayer.current.style.transform = covered ? `translateY(${painted.logicalOffset - next}px)` : '';
    const physical = current.logicalMax ? next / current.logicalMax * current.physicalMax : 0;
    if (syncScroll) {
      expectedScroll.current = physical;
      if (element.current) element.current.scrollTop = physical;
    }
    clearTimeout(idleTimer.current);
    // Keep raw input in a ref, so wheel deltas accumulate without a React render
    // for every event. One frame publishes the newest logical position.
    if (frame.current == null) {
      frame.current = requestAnimationFrame((time) => {
        frame.current = null;
        const offset = Math.min(logicalOffset.current, latest.current.logicalMax);
        logicalOffset.current = offset;
        const velocity = (offset - lastPaint.current.offset) / Math.max(8, Math.min(64, time - lastPaint.current.time));
        lastPaint.current = { offset, time };
        // This is the bounded, lightweight window, not the full file list.
        // Commit it before paint instead of allowing React to defer the handoff.
        flushSync(() => setMotion({ offset, velocity }));
        idleTimer.current = setTimeout(() => {
          lastPaint.current = { offset: logicalOffset.current, time: performance.now() };
          setMotion((previous) => ({ ...previous, velocity: 0 }));
        }, FILE_SCROLL_IDLE_MS);
      });
    }
  }, []);

  useLayoutEffect(() => {
    if (!scrollTarget) return;
    let offset = scrollTarget.index * FILE_ROW_HEIGHT;
    if (scrollTarget.align === 'center') offset -= (viewport - FILE_ROW_HEIGHT) / 2;
    if (scrollTarget.align === 'end') offset -= viewport - FILE_ROW_HEIGHT;
    moveTo(offset);
  }, [scrollTarget, moveTo, viewport]);

  useLayoutEffect(() => {
    const node = element.current;
    if (rowLayer.current.hasAttribute('inert')) return;
    const previous = widthScope.current;
    const canShrink = previous.count !== count || previous.resetKey !== resetKey
      || previous.viewportWidth !== node.clientWidth || (role === 'list' && previous.dataVersion !== dataVersion);
    // Remove the inherited content minimum for measurement, otherwise the old
    // spacer width measures itself forever after its wide children collapse.
    const entries = [...rowLayer.current.children].map((wrapper) => wrapper.firstElementChild)
      .filter((row) => row && !row.querySelector('input, textarea'));
    const styles = entries.map((row) => ({ row, minimum: row.style.minWidth, width: row.style.width }));
    for (const { row } of styles) { row.style.minWidth = '0'; row.style.width = 'max-content'; }
    const measured = entries.reduce((maximum, row) => Math.max(maximum, row.offsetWidth, row.scrollWidth), 0);
    for (const { row, minimum, width } of styles) { row.style.minWidth = minimum; row.style.width = width; }
    const natural = measured > node.clientWidth + 1 ? measured : 0;
    const next = canShrink ? natural : Math.max(contentWidth, natural);
    widthScope.current = { count, resetKey, dataVersion, viewportWidth: node.clientWidth };
    if (Math.abs(next - contentWidth) > 1) setContentWidth(next);
  }, [contentWidth, count, dataVersion, renderRow, motion, viewport, resetKey, role]);

  useLayoutEffect(() => {
    if (!scrollTarget || revealed.current === scrollTarget || frame.current != null || element.current.getAttribute('aria-busy') === 'true') return;
    if (Number.isFinite(scrollTarget.horizontalOffset)) {
      element.current.scrollLeft = scrollTarget.horizontalOffset;
      revealed.current = scrollTarget;
      return;
    }
    if (!scrollTarget.path) return;
    const row = [...rowLayer.current.querySelectorAll('[data-path]')].find((item) => item.dataset.path === scrollTarget.path);
    if (!row) return;
    const target = scrollTarget.revealMatch ? row.querySelector('.explorer-match') || row : row;
    const bounds = element.current.getBoundingClientRect(), match = target.getBoundingClientRect();
    let left = element.current.scrollLeft;
    if (match.left < bounds.left + 12) left += match.left - bounds.left - 12;
    else if (match.right > bounds.left + element.current.clientWidth - 16) left += match.right - bounds.left - element.current.clientWidth + 16;
    left = Math.max(0, left);
    if (left > element.current.scrollWidth - element.current.clientWidth + 1) return;
    element.current.scrollLeft = left;
    revealed.current = scrollTarget;
  }, [scrollTarget, motion, dataVersion, contentWidth]);

  useEffect(() => () => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = null;
    clearTimeout(idleTimer.current);
    idleTimer.current = null;
  }, []);

  useLayoutEffect(() => {
    const node = element.current;
    let scheduled = null;
    const measure = () => {
      scheduled = null;
      const height = node.clientHeight;
      if (height > 0) setViewport((previous) => previous === height ? previous : height);
    };
    const resize = () => { if (scheduled == null) scheduled = requestAnimationFrame(measure); };
    measure();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => { observer.disconnect(); if (scheduled != null) cancelAnimationFrame(scheduled); };
  }, []);

  useLayoutEffect(() => {
    // A page-cache update may render while an input frame is pending. Never
    // snap the scrollbar back to that render's older logical offset.
    const physical = frame.current == null ? windowState.physicalOffset
      : windowState.logicalMax ? logicalOffset.current / windowState.logicalMax * windowState.physicalMax : 0;
    expectedScroll.current = physical;
    element.current.scrollTop = physical;
    if (frame.current == null) {
      rowLayer.current.style.transform = '';
    }
  }, [motion, windowState.physicalOffset, windowState.logicalMax, windowState.physicalMax]);

  useLayoutEffect(() => {
    onRangeChange?.(windowState.start, windowState.end, {
      visibleStart: windowState.visibleStart, visibleEnd: windowState.visibleEnd,
      direction: windowState.direction, velocity: motion.velocity,
    });
  }, [dataVersion, onRangeChange, windowState.start, windowState.end, windowState.visibleStart,
    windowState.visibleEnd, windowState.direction, motion.velocity]);

  useEffect(() => {
    const node = element.current;
    const wheel = (event) => {
      const current = latest.current;
      if (event.shiftKey && !event.ctrlKey && !event.deltaX && node.scrollWidth > node.clientWidth) {
        event.preventDefault(); node.scrollLeft += event.deltaY; return;
      }
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || current.logicalMax <= current.physicalMax) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? FILE_ROW_HEIGHT : event.deltaMode === 2 ? node.clientHeight : 1);
      moveTo(logicalOffset.current + delta);
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, [moveTo]);

  const rows = [];
  for (let index = windowState.start; index < windowState.end; index += 1) rows.push(index);
  // Keep an active rename input mounted (and visible) while the user scrolls.
  if (pinnedIndex >= 0 && pinnedIndex < count && !rows.includes(pinnedIndex)) rows.push(pinnedIndex);
  let ready = true;
  if (isRowReady) {
    for (let index = windowState.visibleStart; index < windowState.visibleEnd; index++) {
      if (!isRowReady(index)) { ready = false; break; }
    }
  }
  // Keep the resident viewport while a new page is in flight. Never substitute
  // skeletons, stale clickable targets or an empty viewport during a wheel burst.
  const renderedRows = ready || !resident.current ? rows.map((index) => {
    const outside = index < windowState.start || index >= windowState.end;
    const top = outside ? 0 : index * FILE_ROW_HEIGHT - windowState.logicalOffset;
    return <div key={index} className="file-tree__virtual-row" data-pinned={index === pinnedIndex ? 'true' : undefined}>
      {renderRow(index, { position: 'absolute', top, left: 0, minWidth: '100%', width: 'max-content', boxSizing: 'border-box', height: FILE_ROW_HEIGHT }, {
        deferDetails: index !== pinnedIndex && Math.abs(motion.velocity) >= FAST_FILE_SCROLL_SPEED,
      })}
    </div>;
  }) : resident.current.rows.filter((row) => row.props['data-pinned'] !== 'true' || resident.current.pinnedIndex === pinnedIndex);
  if (ready) resident.current = { geometry: windowState, rows: renderedRows, pinnedIndex };

  return (
    <div
      className="file-tree__list"
      ref={element}
      tabIndex={0}
      role={role}
      aria-label={ariaLabel}
      data-scrolling={Math.abs(motion.velocity) >= FAST_FILE_SCROLL_SPEED ? 'fast' : 'idle'}
      aria-busy={!ready || undefined}
      onScroll={(event) => {
        const physical = event.currentTarget.scrollTop;
        if (expectedScroll.current != null && Math.abs(physical - expectedScroll.current) <= 1) return;
        expectedScroll.current = null;
        const current = latest.current;
        const next = current.physicalMax ? physical / current.physicalMax * current.logicalMax : 0;
        moveTo(next, false);
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const current = latest.current;
        const destinations = {
          ArrowDown: logicalOffset.current + FILE_ROW_HEIGHT,
          ArrowUp: logicalOffset.current - FILE_ROW_HEIGHT,
          PageDown: logicalOffset.current + viewport,
          PageUp: logicalOffset.current - viewport,
          Home: 0,
          End: current.logicalMax,
        };
        if (Object.hasOwn(destinations, event.key)) {
          event.preventDefault();
          moveTo(destinations[event.key]);
        }
      }}
    >
      <div style={{ height: windowState.physicalHeight, position: 'relative', minWidth: contentWidth || '100%' }}>
        <div className="file-tree__viewport" ref={viewportLayer} style={{ height: Math.min(viewport, windowState.physicalHeight) }}>
          <div className="file-tree__rows" ref={rowLayer} inert={!ready ? '' : undefined} style={{ pointerEvents: ready ? undefined : 'none' }}>
            {renderedRows}
            <CurrentFileIndicator currentPath={currentFilePath} layerRef={rowLayer} />
          </div>
        </div>
        {footer && (
          <div className="file-tree__footer" style={{ position: 'absolute', top: count * FILE_ROW_HEIGHT, left: 0, right: 0, height: FILE_ROW_HEIGHT }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
