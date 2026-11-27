import { useEffect, useState } from 'react';

const source = { fontSize: 13, lineHeight: 20 };
const markdown = { fontSize: 14, lineHeight: 22 };
const clamp = (size) => Math.max(10, Math.min(24, size));

export default function useComparisonTypography(rootRef, comparison, rendered = false) {
  const base = rendered ? markdown : source;
  const [zoom, setZoom] = useState(null);
  const fontSize = clamp(base.fontSize + (zoom?.comparison === comparison ? zoom.offset : 0));

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let wheelDelta = 0;
    let resetTimer;
    const handleWheel = (event) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.deltaY === 0 ||
        !event.target.closest?.('[data-comparison-zoom]')
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      wheelDelta += event.deltaY;
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        wheelDelta = 0;
      }, 250);
      if (Math.abs(wheelDelta) < 24) return;
      const step = wheelDelta > 0 ? -1 : 1;
      wheelDelta = 0;
      setZoom((current) => {
        const offset = current?.comparison === comparison ? current.offset : 0;
        const size = clamp(base.fontSize + offset);
        const next = clamp(size + step);
        return { comparison, offset: next - base.fontSize };
      });
    };

    root.addEventListener('wheel', handleWheel, { capture: true, passive: false });
    return () => {
      clearTimeout(resetTimer);
      root.removeEventListener('wheel', handleWheel, true);
    };
  }, [base.fontSize, comparison, rootRef]);

  return { fontSize, lineHeight: Math.round((base.lineHeight * fontSize) / base.fontSize) };
}
