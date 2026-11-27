import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button, InputNumber, Tooltip } from 'antd';
import { MAX_TABLE_ROWS, MAX_TABLE_COLUMNS, tableDimensions } from './tableDimensions';
import {
  clearEditorPopupRoom,
  editorPopupBounds,
  editorPopupRoomBelow,
  makeEditorPopupRoom,
  placeEditorPopup,
} from './editorPopupPlacement';
import './table-picker.scss';

export default function TablePicker({
  onInsert, onClose, onDismiss = onClose, initialRows = 3, initialColumns = 3,
  resize = false, anchor, scroller, getBounds,
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState(initialRows), [columns, setColumns] = useState(initialColumns);
  const panelRef = useRef(null);
  useLayoutEffect(() => {
    if (!anchor) return undefined;
    const panel = panelRef.current;
    const window = anchor.ownerDocument.defaultView;
    const position = (reveal = false) => {
      if (!anchor.isConnected) return;
      const area = scroller?.getBoundingClientRect() ?? getBounds?.();
      const bounds = editorPopupBounds(window, area);
      let rect = anchor.getBoundingClientRect();
      const height = panel.scrollHeight + panel.offsetHeight - panel.clientHeight;
      if (reveal && scroller && rect.bottom > bounds.top && rect.top < bounds.bottom) {
        const target = Math.min(height, bounds.bottom - bounds.top - rect.height - 22);
        makeEditorPopupRoom(scroller, target - editorPopupRoomBelow(bounds, rect));
        rect = anchor.getBoundingClientRect();
      }
      const width = 236;
      const { left, top, maxWidth, maxHeight } = placeEditorPopup(
        bounds,
        { top: rect.top, bottom: rect.bottom, left: resize ? rect.left : rect.left + (rect.width - width) / 2 },
        width, height, resize ? 'below' : 'above',
      );
      Object.assign(panel.style, {
        left: `${left}px`,
        top: `${top}px`,
        maxWidth: `${maxWidth}px`,
        maxHeight: `${maxHeight}px`,
        visibility: rect.bottom > bounds.top && rect.top < bounds.bottom && maxHeight > 0 ? 'visible' : 'hidden',
      });
    };
    const update = () => position();
    const resizePopup = () => position(true);
    position(true);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(anchor);
    observer?.observe(panel);
    if (scroller) observer?.observe(scroller);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', resizePopup);
    window.visualViewport?.addEventListener('resize', resizePopup);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', resizePopup);
      window.visualViewport?.removeEventListener('resize', resizePopup);
      window.visualViewport?.removeEventListener('scroll', update);
      if (scroller) clearEditorPopupRoom(scroller);
    };
  }, [anchor, getBounds, resize, scroller]);
  useEffect(() => {
    if (!anchor) return undefined;
    const doc = anchor.ownerDocument;
    const outside = (event) => {
      if (!anchor.contains(event.target) && !panelRef.current?.contains(event.target)) onDismiss();
    };
    doc.addEventListener('pointerdown', outside);
    return () => doc.removeEventListener('pointerdown', outside);
  }, [anchor, onDismiss]);
  useEffect(() => {
    const panel = panelRef.current;
    let axis = '', accumulated = 0, lastTime = 0;
    const wheel = (event) => {
      const control = event.target.closest?.('.ant-input-number');
      if (!control?.contains(document.activeElement) || !event.deltaY || event.ctrlKey || event.metaKey || event.altKey) return;
      const nextAxis = control.closest('[data-table-axis]')?.dataset.tableAxis;
      if (!nextAxis) return;
      event.preventDefault();
      event.stopPropagation();
      // A wheel notch changes once; small trackpad events accumulate into a step.
      if (axis !== nextAxis || event.timeStamp - lastTime > 180 || Math.sign(accumulated) !== Math.sign(event.deltaY)) accumulated = 0;
      axis = nextAxis; lastTime = event.timeStamp;
      const delta = event.deltaMode ? event.deltaY * 40 : event.deltaY;
      accumulated += delta;
      if (Math.abs(accumulated) < 40) return;
      accumulated = 0;
      const amount = Math.sign(delta) * (event.shiftKey ? 5 : 1);
      const max = axis === 'rows' ? MAX_TABLE_ROWS : MAX_TABLE_COLUMNS;
      (axis === 'rows' ? setRows : setColumns)((value) => Math.min(max, Math.max(1, (value ?? 1) - amount)));
    };
    panel.addEventListener('wheel', wheel, { passive: false });
    return () => panel.removeEventListener('wheel', wheel);
  }, []);
  const insert = (r, c) => { if (tableDimensions(r, c)) onInsert(r, c); };
  // 网格滑过时行列数也会跟着变；antd 的 InputNumber 清空时给到 null，回落到 1 免得空值。
  const clamp = (value, max) => Math.min(max, Math.max(1, value ?? 1));
  const panel = <div ref={panelRef} className={anchor ? 'ft__table-panel ft__table-panel--anchored' : 'ft__table-panel'} role="dialog" aria-label={t(resize ? 'table.resize' : 'table.insert')}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}>
    <div className="ft__table-size">{t('table.size', { rows, columns })}</div>
    <div className="ft__table-grid">
      {Array.from({ length: 36 }, (_, index) => {
        const r = Math.floor(index / 6) + 1, c = index % 6 + 1;
        return <button key={index} type="button" className={r <= rows && c <= columns ? 'is-selected' : ''}
          aria-label={t('table.size', { rows: r, columns: c })}
          onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => { setRows(r); setColumns(c); }}
          onClick={() => insert(r, c)} />;
      })}
    </div>
    <form onSubmit={(event) => { event.preventDefault(); insert(clamp(rows, MAX_TABLE_ROWS), clamp(columns, MAX_TABLE_COLUMNS)); }}>
      <Tooltip title={t('table.wheelHint')} placement="top" mouseEnterDelay={0.3}>
        <label data-table-axis="rows">{t('table.rows')}
          <InputNumber size="small" aria-label={t('table.rows')} min={1} max={MAX_TABLE_ROWS} value={rows}
            changeOnWheel={false}
            onChange={(value) => setRows(clamp(value, MAX_TABLE_ROWS))} />
        </label>
      </Tooltip>
      <Tooltip title={t('table.wheelHint')} placement="top" mouseEnterDelay={0.3}>
        <label data-table-axis="columns">{t('table.columns')}
          <InputNumber size="small" aria-label={t('table.columns')} min={1} max={MAX_TABLE_COLUMNS} value={columns}
            changeOnWheel={false}
            onChange={(value) => setColumns(clamp(value, MAX_TABLE_COLUMNS))} />
        </label>
      </Tooltip>
      <Button size="small" htmlType="submit">{t(resize ? 'table.resize' : 'table.insert')}</Button>
    </form>
  </div>;
  return anchor ? createPortal(panel, anchor.ownerDocument.body) : panel;
}
