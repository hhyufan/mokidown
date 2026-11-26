import { Tooltip } from 'antd';
import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@utils/classNames';

export default function SidebarTabs({
  items,
  activeId,
  onChange,
  onMinWidthChange,
  renderIcon: Icon,
}) {
  const { t } = useTranslation();
  const listRef = useRef(null);
  const sliderRef = useRef(null);
  const sizeProbe = useRef(null);
  const buttons = useRef(new Map());
  const position = useRef(null);
  const animation = useRef(null);
  const visibleIds = items
    .filter((item) => item.visible)
    .map((item) => item.id)
    .join(' ');
  const visibleCount = items.filter((item) => item.visible).length;

  useLayoutEffect(() => {
    const probe = sizeProbe.current;
    const sidebar = probe?.closest('.sidebar');
    if (!probe || !sidebar) return undefined;
    // 只按滑动导航的文字宽度计算，不再把工具栏/文件树按钮的宽度算进来。
    const tabs = probe.querySelector('.sidebar__tabs-measure');
    if (!tabs) return undefined;
    const measure = () => {
      const style = getComputedStyle(sidebar);
      const insets = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce(
        (total, key) => total + (parseFloat(style[key]) || 0),
        0,
      );
      const tabsStyle = getComputedStyle(tabs);
      const width =
        tabs.getBoundingClientRect().width +
        (parseFloat(tabsStyle.marginLeft) || 0) +
        (parseFloat(tabsStyle.marginRight) || 0);
      // 导航文字宽度之外再留一点左右呼吸空间，避免侧边栏贴得过紧。
      if (width) {
        // 两个/三个标签时保留更舒适的最小宽度；标签越多最小宽度递增。
        const countMinimum = 220 + Math.max(0, visibleCount - 1) * 60;
        onMinWidthChange(Math.max(countMinimum, width + insets + 16));
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(tabs);
    return () => observer.disconnect();
  }, [onMinWidthChange, visibleCount]);

  useLayoutEffect(() => {
    const list = listRef.current;
    const active = buttons.current.get(activeId);
    const slider = sliderRef.current;
    if (!list || !active || !slider) return undefined;
    const update = () => {
      const container = list.getBoundingClientRect();
      const target = active.getBoundingClientRect();
      const next = {
        id: activeId,
        left: target.left - container.left + list.scrollLeft - slider.offsetLeft,
        width: target.width,
      };
      if (next.width <= 0) return;
      const previous = position.current;
      if (previous?.id === next.id && previous.left === next.left && previous.width === next.width)
        return;
      const switched = previous && previous.id !== next.id;
      const before = switched ? getComputedStyle(slider) : null;
      const start = before && { transform: before.transform, width: before.width };
      animation.current?.cancel();
      position.current = next;
      slider.style.width = `${next.width}px`;
      slider.style.transform = `translateX(${next.left}px)`;
      if (start && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        animation.current = slider.animate?.(
          [start, { transform: slider.style.transform, width: slider.style.width }],
          { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' },
        );
      }
      if (switched && list.scrollWidth > list.clientWidth) {
        if (target.left < container.left) list.scrollLeft += target.left - container.left;
        else if (target.right > container.right) list.scrollLeft += target.right - container.right;
      }
    };
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(list);
    buttons.current.forEach((button) => {
      if (!button.disabled) observer.observe(button);
    });
    return () => observer.disconnect();
  }, [activeId, visibleIds]);
  useLayoutEffect(() => () => animation.current?.cancel(), []);

  return (
    <>
      <div ref={listRef} className="sidebar__tabs" role="tablist" aria-label={t('sidebar.tabs')}>
        <div ref={sliderRef} className="sidebar__tab-slider" aria-hidden="true" />
        {items.map((item) => (
          <div
            key={item.id}
            className={cn('sidebar__tab-slot', !item.visible && 'sidebar__tab-slot--hidden')}
            aria-hidden={!item.visible || undefined}
          >
            <Tooltip title={item.label} mouseEnterDelay={0.3}>
              <button
                ref={(element) => {
                  if (element) buttons.current.set(item.id, element);
                  else buttons.current.delete(item.id);
                }}
                type="button"
                role="tab"
                disabled={!item.visible}
                tabIndex={item.visible ? 0 : -1}
                aria-label={item.label}
                aria-selected={item.visible && activeId === item.id}
                className={cn(
                  'sidebar__tab',
                  activeId === item.id && item.visible && 'sidebar__tab--active',
                )}
                onClick={() => onChange(item.id)}
              >
                <Icon id={item.id} />
                <span>{item.label}</span>
              </button>
            </Tooltip>
          </div>
        ))}
      </div>
      <div className="sidebar__size-probe" aria-hidden="true">
        <div className="sidebar__size-probe-content" ref={sizeProbe}>
          <div className="sidebar__tabs-measure">
            {items
              .filter((item) => item.visible)
              .map(({ id, label }) => (
                <span className="sidebar__tab-measure-button" key={id}>
                  <Icon id={id} />
                  <span data-measure-label={label} />
                </span>
              ))}
          </div>
          {['sidebar.explorer.title', 'sidebar.project.title'].map((label) => (
            <div className="sidebar__toolbar" key={label}>
              <span className="sidebar__toolbar-label sidebar__explorer-heading">
                <span data-measure-label={t(label)} />
                <span className="sidebar__mode-toggle" />
              </span>
              <span className="stb" />
              <span className="stb" />
              <span className="stb" />
              <span className="stb" />
              <span className="stb-sep" />
              <span className="stb" />
            </div>
          ))}
          <div className="file-tree__nav file-tree__nav--project">
            <span className="file-tree__nav-btn" />
            <span className="file-tree__nav-btn" />
            <span className="file-tree__nav-btn" />
            <span className="file-tree__nav-sep" />
            <span className="file-tree__nav-btn" />
            <span className="file-tree__nav-btn" />
            <span className="file-tree__nav-sep" />
            <span className="file-tree__nav-btn" />
            <span className="file-tree__nav-btn" />
            <span className="file-tree__nav-btn" />
          </div>
        </div>
      </div>
    </>
  );
}
