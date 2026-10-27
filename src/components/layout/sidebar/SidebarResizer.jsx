import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import useEditorStore from '@store/useEditorStore';

export default function SidebarResizer() {
  const { t } = useTranslation();
  const width = useEditorStore((s) => s.sidebarWidth);
  const setWidth = useEditorStore((s) => s.setSidebarWidth);
  const minimum = useEditorStore((s) => s.sidebarMinWidth);
  const drag = useRef(null);
  const limit = Math.max(minimum, Math.min(Math.max(640, minimum), window.innerWidth - 360));
  const update = (value) => setWidth(Math.min(limit, value));
  return <div className="sidebar__resizer" role="separator" tabIndex={0}
    aria-label={t('knowledgeTree.resizeSidebar')} aria-orientation="vertical"
    aria-valuemin={minimum} aria-valuemax={limit} aria-valuenow={Math.max(minimum, Math.min(width, limit))}
    onDoubleClick={() => update(280)}
    onKeyDown={(event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      update(event.key === 'Home' ? minimum : event.key === 'End' ? limit : Math.max(width, minimum) + (event.key === 'ArrowLeft' ? -16 : 16));
    }}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, width: event.currentTarget.parentElement.getBoundingClientRect().width };
    }}
    onPointerMove={(event) => { if (drag.current) update(drag.current.width + event.clientX - drag.current.x); }}
    onPointerUp={(event) => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} />;
}
