import { useEffect, useState } from 'react';
import { getSnapshotFramePadding } from '@utils/snapshotExport';

export function useStageMaxCardWidth(scrollRef, backdrop, padding) {
  const [maxWidth, setMaxWidth] = useState(960);

  useEffect(() => {
    const el = scrollRef?.current;
    if (!el) return undefined;

    const stagePad = getSnapshotFramePadding(backdrop, padding);
    const measure = () => {
      const style = window.getComputedStyle(el);
      const padX =
        (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      const innerWidth = el.clientWidth - padX;
      if (innerWidth <= 0) return;
      const available = innerWidth - stagePad * 2 - 16;
      const clamped = Math.max(260, Math.min(960, Math.floor(available / 10) * 10));
      setMaxWidth(clamped);
    };

    measure();
    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollRef, backdrop, padding]);

  return maxWidth;
}
