import { Tooltip } from 'antd';
import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@utils/classNames';

export default function SidebarTabs({ items, activeId, onChange, onMinWidthChange, renderIcon: Icon }) {
  const { t } = useTranslation();
  const listRef = useRef(null);
  const sliderRef = useRef(null);
  const buttons = useRef(new Map());
  const measurementKey = JSON.stringify(items.map(({ id, label, visible }) => [id, label, visible]));

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !onMinWidthChange) return undefined;
    const visible = [...buttons.current.values()].filter((button) => !button.disabled);
    const measure = () => {
      let naturalWidth = 0;
      for (const button of visible) {
        const style = getComputedStyle(button);
        const label = button.lastElementChild;
        const icon = button.firstElementChild;
        const width = label.scrollWidth + icon.getBoundingClientRect().width
          + (parseFloat(style.columnGap) || 0) + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        naturalWidth = Math.max(naturalWidth, Math.ceil(width) + 2);
        button.parentElement.style.setProperty('--tab-natural-width', `${Math.ceil(width) + 2}px`);
      }
      const style = getComputedStyle(list);
      const spacing = ['marginLeft', 'marginRight', 'paddingLeft', 'paddingRight'].reduce((total, key) => total + (parseFloat(style[key]) || 0), 0);
      onMinWidthChange(naturalWidth * visible.length + spacing + 1);
    };
    measure();
    let stopped = false;
    document.fonts?.ready.then(() => { if (!stopped) measure(); });
    document.fonts?.addEventListener('loadingdone', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    visible.forEach((button) => observer?.observe(button.lastElementChild));
    return () => { stopped = true; observer?.disconnect(); document.fonts?.removeEventListener('loadingdone', measure); };
  }, [measurementKey, onMinWidthChange]);

  useLayoutEffect(() => {
    const list = listRef.current;
    const active = buttons.current.get(activeId);
    const slider = sliderRef.current;
    if (!list || !active || !slider) return undefined;
    const update = () => {
      const container = list.getBoundingClientRect();
      const target = active.getBoundingClientRect();
      slider.style.width = `${target.width}px`;
      slider.style.transform = `translateX(${target.left - container.left + list.scrollLeft - 5}px)`;
    };
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(list);
    observer.observe(active);
    return () => observer.disconnect();
  }, [activeId]);

  return <div ref={listRef} className="sidebar__tabs" role="tablist" aria-label={t('sidebar.tabs')}>
    <div ref={sliderRef} className="sidebar__tab-slider" aria-hidden="true" />
    {items.map((item) => <div key={item.id}
      className={cn('sidebar__tab-slot', !item.visible && 'sidebar__tab-slot--hidden')}
      aria-hidden={!item.visible || undefined}>
      <Tooltip title={item.label} mouseEnterDelay={0.3}><button ref={(element) => { if (element) buttons.current.set(item.id, element); else buttons.current.delete(item.id); }}
        type="button" role="tab"  disabled={!item.visible} tabIndex={item.visible ? 0 : -1}
        aria-selected={item.visible && activeId === item.id}
        className={cn('sidebar__tab', activeId === item.id && item.visible && 'sidebar__tab--active')}
        onClick={() => onChange(item.id)}>
        <Icon id={item.id} /><span>{item.label}</span>
      </button></Tooltip>
    </div>)}
  </div>;
}
