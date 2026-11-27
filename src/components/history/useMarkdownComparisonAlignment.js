import { useLayoutEffect, useRef } from 'react';
import { comparisonLineReaders } from './comparisonLineReaders';
import { hasPendingMilkdownCodeBlocks } from '@components/editor/milkdownViewport';

const anchorSelector = '[data-history-anchor]';

function setPixels(element, property, value) {
  if (Math.abs((parseFloat(element.style[property]) || 0) - value) > 0.25)
    element.style[property] = `${value}px`;
}

export function useMarkdownComparisonAlignment(ref, visibleRows, onAligned, enabled) {
  const alignRows = useRef(null);
  const onAlignedRef = useRef(onAligned);
  onAlignedRef.current = onAligned;
  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const root = ref.current;
    if (!root) return undefined;
    const layout = root.querySelector('.history-markdown-draft__layout');
    let frame = 0;
    let refresh = true;
    let editors = [];
    let rows = [];
    let anchors = [];
    let observed = new Set();

    const align = () => {
      frame = 0;
      if (!root.clientWidth) return;
      if (refresh) {
        refresh = false;
        editors = [...layout.querySelectorAll('.history-markdown-draft__pane .milkdown-editor')];
        rows = [...layout.querySelectorAll(':scope > [data-history-row]')];
        anchors = editors.map((editor) => [
          ...editor.querySelectorAll(`:scope > ${anchorSelector}`),
        ]);
        const next = new Set(
          editors.flatMap((editor) =>
            [...editor.children].filter((child) => !child.matches(anchorSelector)),
          ),
        );
        for (const element of observed) if (!next.has(element)) resize.unobserve(element);
        for (const element of next) if (!observed.has(element)) resize.observe(element);
        observed = next;
      }
      if (
        anchors.length !== 2 ||
        anchors.some(
          (pane) =>
            pane.length !== rows.length + 1 ||
            pane.at(-1)?.dataset.historyAnchor !== 'end' ||
            rows.some((row, i) => row.dataset.historyRow !== pane[i].dataset.historyAnchor),
        )
      ) {
        // The editor can briefly be ahead of the worker. Retain the last measured rows.
        return;
      }

      const boxes = anchors.map((pane) => pane.map((anchor) => anchor.getBoundingClientRect()));
      let top = boxes[0][0].bottom - layout.getBoundingClientRect().top;
      const measurements = rows.map((row, i) => {
        const heights = boxes.map((pane) => Math.max(0, pane[i + 1].top - pane[i].bottom));
        const changed = row.hasAttribute('data-changed');
        const controls = [...row.querySelectorAll('[data-history-line]')];
        const offsets = [0, 0];
        const actions = controls.map((control) => {
          const side = control.parentElement.dataset.direction === 'right' ? 0 : 1;
          const anchorTop = boxes[side][i].bottom;
          const lineTop = comparisonLineReaders.get(editors[side])?.(
            Number(control.dataset.historyLine),
          );
          const position = lineTop == null ? offsets[side] : Math.max(0, lineTop - anchorTop);
          offsets[side] = position + control.offsetHeight;
          return { control, position };
        });
        const minimum = row.hasAttribute('data-fold') ? 24 : changed ? 26 : 0;
        const height = Math.max(minimum, ...heights, ...offsets);
        const boundary = boxes[0][i + 1].height - (parseFloat(anchors[0][i + 1].style.height) || 0);
        const measurement = {
          top,
          height: Math.max(0, height + boundary),
          gaps: heights.map((size) => height - size),
          actions,
        };
        top += measurement.height;
        return measurement;
      });

      for (const [i, row] of rows.entries()) {
        const { top, height, gaps, actions } = measurements[i];
        for (const [side, gap] of gaps.entries()) setPixels(anchors[side][i + 1], 'height', gap);
        if (!row.style.top) row.style.top = '0px';
        setPixels(row, 'top', top);
        setPixels(row, 'height', height);
        for (const { control, position } of actions) setPixels(control, 'top', position);
        if (row.dataset.positioned === undefined) row.dataset.positioned = '';
      }
      if (!root.hasAttribute('data-aligned')) {
        if (hasPendingMilkdownCodeBlocks(root)) {
          schedule();
          return;
        }
        root.setAttribute('data-aligned', '');
      }
      onAlignedRef.current?.();
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(align);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(root);
    const mutations = new MutationObserver((records) => {
      if (
        !records.some(
          ({ target }) =>
            target === layout ||
            editors.includes(target) ||
            target.matches?.('[data-history-row]') ||
            (target.closest?.('.history-markdown-draft__pane') &&
              (!root.hasAttribute('data-aligned') ||
                editors.some((editor) => !editor.isConnected))),
        )
      )
        return;
      refresh = true;
      schedule();
    });
    mutations.observe(layout, { childList: true, subtree: true });
    alignRows.current = () => {
      refresh = true;
      if (frame) cancelAnimationFrame(frame);
      align();
    };
    schedule();
    return () => {
      mutations.disconnect();
      resize.disconnect();
      alignRows.current = null;
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled, ref]);

  useLayoutEffect(() => {
    alignRows.current?.();
  }, [visibleRows]);
}
