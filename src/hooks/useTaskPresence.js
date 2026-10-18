import { useEffect, useRef, useState } from 'react';

const keyOf = (item) => `${item.kind}:${item.id}`;
export default function useTaskPresence(items, { minimumMs = 650, exitMs = 220 } = {}) {
  const [leaving, setLeaving] = useState([]);
  const previous = useRef(new Map());
  const snapshot = useRef(items); snapshot.current = items;
  const fingerprint = JSON.stringify(items);
  useEffect(() => {
    const items = snapshot.current;
    const now = Date.now(), incoming = new Set(items.map(keyOf)), timers = [];
    for (const item of items) {
      const key = keyOf(item), old = previous.current.get(key);
      previous.current.set(key, { item, since: old?.since ?? now });
    }
    const removed = [...previous.current].filter(([key]) => !incoming.has(key));
    setLeaving(removed.map(([, entry]) => ({ ...entry.item, leaving: false })));
    for (const [key, entry] of removed) {
      const delay = Math.max(0, entry.since + minimumMs - now);
      timers.push(setTimeout(() => setLeaving((current) => current.map((item) => keyOf(item) === key ? { ...item, leaving: true } : item)), delay));
      timers.push(setTimeout(() => {
        previous.current.delete(key);
        setLeaving((current) => current.filter((item) => keyOf(item) !== key));
      }, delay + exitMs));
    }
    return () => timers.forEach(clearTimeout);
  }, [fingerprint, minimumMs, exitMs]);
  const keys = new Set(items.map(keyOf));
  return [...items, ...leaving.filter((item) => !keys.has(keyOf(item)))];
}
