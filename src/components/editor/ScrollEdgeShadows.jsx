import { useLayoutEffect, useRef } from 'react';
import './scroll-edge-shadows.scss';

const TOLERANCE = 1;

export default function ScrollEdgeShadows({ editor, selector }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const overlay = ref.current;
    const host = overlay.parentElement;
    const paint = (top, height, total) => {
      overlay.toggleAttribute('data-top', height > 0 && top > TOLERANCE);
      overlay.toggleAttribute('data-bottom', height > 0 && total - top - height > TOLERANCE);
    };
    if (editor?.getLayoutInfo && editor.getScrollHeight) {
      const update = () =>
        paint(editor.getScrollTop(), editor.getLayoutInfo().height, editor.getScrollHeight());
      const subscriptions = [
        editor.onDidScrollChange?.(update),
        editor.onDidContentSizeChange?.(update),
        editor.onDidLayoutChange?.(update),
      ];
      update();
      return () => subscriptions.forEach((subscription) => subscription?.dispose());
    }
    if (!selector) {
      paint(0, 0, 0);
      return undefined;
    }

    let scroller;
    let content;
    let frame = 0;
    const update = () => {
      frame = 0;
      const element = host.querySelector(selector);
      const body = element?.firstElementChild;
      if (element !== scroller || body !== content) {
        resize?.disconnect();
        if (element) resize?.observe(element);
        if (body) resize?.observe(body);
        scroller = element;
        content = body;
      }
      paint(scroller?.scrollTop ?? 0, scroller?.clientHeight ?? 0, scroller?.scrollHeight ?? 0);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    const mutations = new MutationObserver((records) => {
      if (records.some((record) => record.target !== overlay)) schedule();
    });
    mutations.observe(host, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden'],
    });
    const scroll = (event) => {
      if (event.target === scroller) schedule();
    };
    host.addEventListener('scroll', scroll, true);
    host.addEventListener('load', schedule, true);
    update();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resize?.disconnect();
      mutations.disconnect();
      host.removeEventListener('scroll', scroll, true);
      host.removeEventListener('load', schedule, true);
    };
  }, [editor, selector]);

  return <div className="editor-scroll-edges" aria-hidden="true" ref={ref} />;
}
