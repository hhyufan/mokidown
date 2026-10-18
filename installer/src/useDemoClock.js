import { useEffect, useState } from 'react';

// Only mounted for the active slide, so leaving a demo cancels its playback.
// Passing a cycle keeps the timeline looping while the slide stays visible.
export default function useDemoClock(cycle = 0) {
  const [elapsed, setElapsed] = useState(() =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ? Infinity : 0,
  );
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const start = performance.now();
    const timer = setInterval(() => {
      const value = performance.now() - start;
      setElapsed(cycle > 0 ? value % cycle : value);
    }, 40);
    return () => clearInterval(timer);
  }, [cycle]);
  return elapsed;
}
