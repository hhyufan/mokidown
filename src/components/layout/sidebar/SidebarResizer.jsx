import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import useEditorStore from '@store/useEditorStore';

export default function SidebarResizer() {
  const { t } = useTranslation();
  const width = useEditorStore((s) => s.sidebarWidth);
  const setWidth = useEditorStore((s) => s.setSidebarWidth);
  const minimum = useEditorStore((s) => s.sidebarMinWidth);
  const drag = useRef(null);
  const getLimit = () =>
    Math.max(minimum, Math.min(Math.max(640, minimum), window.innerWidth - 360));
  const limit = getLimit();
  const clampWidth = (value) => Math.max(minimum, Math.min(getLimit(), value));
  const update = (value) => setWidth(clampWidth(value));
  useEffect(
    () => () => {
      const gesture = drag.current;
      if (!gesture) return;
      cancelAnimationFrame(gesture.frame);
      gesture.sidebar.style.removeProperty('--sidebar-drag-width');
    },
    [],
  );
  const stop = (event) => {
    const gesture = drag.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    drag.current = null;
    cancelAnimationFrame(gesture.frame);
    if (event.type === 'pointerup') gesture.nextWidth = gesture.width + event.clientX - gesture.x;
    update(gesture.nextWidth);
    gesture.sidebar.style.setProperty(
      '--sidebar-width',
      `${useEditorStore.getState().sidebarWidth}px`,
    );
    gesture.sidebar.style.removeProperty('--sidebar-drag-width');
    delete event.currentTarget.dataset.resizing;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <div
      className="sidebar__resizer"
      role="separator"
      tabIndex={0}
      aria-label={t('knowledgeTree.resizeSidebar')}
      aria-orientation="vertical"
      aria-valuemin={minimum}
      aria-valuemax={limit}
      aria-valuenow={Math.max(minimum, Math.min(width, limit))}
      onDoubleClick={() => update(280)}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        update(
          event.key === 'Home'
            ? minimum
            : event.key === 'End'
              ? limit
              : Math.max(width, minimum) + (event.key === 'ArrowLeft' ? -16 : 16),
        );
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        event.preventDefault();
        const handle = event.currentTarget;
        const sidebar = handle.parentElement;
        const width = sidebar.getBoundingClientRect().width;
        sidebar.style.setProperty('--sidebar-drag-width', `${width}px`);
        handle.dataset.resizing = 'true';
        handle.setPointerCapture(event.pointerId);
        drag.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          sidebar,
          width,
          nextWidth: width,
          frame: 0,
        };
      }}
      onPointerMove={(event) => {
        const gesture = drag.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        gesture.nextWidth = gesture.width + event.clientX - gesture.x;
        if (!gesture.frame) {
          const handle = event.currentTarget;
          gesture.frame = requestAnimationFrame(() => {
            gesture.frame = 0;
            const nextWidth = clampWidth(gesture.nextWidth);
            gesture.sidebar.style.setProperty('--sidebar-drag-width', `${nextWidth}px`);
            handle.setAttribute('aria-valuenow', Math.round(nextWidth));
          });
        }
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
    />
  );
}
