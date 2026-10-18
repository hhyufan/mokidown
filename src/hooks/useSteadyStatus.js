import { useEffect, useRef, useState } from 'react';

export default function useSteadyStatus(item) {
  const [shown, setShown] = useState(item);
  const busySince = useRef(item.busy ? Date.now() : 0);
  const current = useRef(item); current.current = item;
  useEffect(() => {
    const delay = !shown.busy && item.busy ? 180 : shown.busy && !item.busy ? Math.max(0, busySince.current + 450 - Date.now()) : 60;
    const timer = setTimeout(() => {
      if (current.current.busy && !shown.busy) busySince.current = Date.now();
      setShown(current.current);
    }, delay);
    return () => clearTimeout(timer);
  }, [item, shown.busy]);
  return { ...item, text: shown.text, title: shown.title, tone: shown.tone, busy: shown.busy, icon: shown.icon };
}
