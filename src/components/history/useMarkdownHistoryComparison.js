import { useEffect, useRef, useState } from 'react';

export function useMarkdownHistoryComparison(original, modified, enabled) {
  const [result, setResult] = useState(null);
  const clientRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let worker;
    let active = null;
    let requested = null;
    const fail = (error) => {
      worker?.terminate();
      worker = null;
      setResult({ original, error: String(error?.message || error) });
    };
    const open = () => {
      worker = new Worker(new URL('../../workers/markdownHistory.worker.js', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = ({ data }) => {
        if (requested === active) {
          const modified = active.modified;
          setResult((previous) => ({
            original,
            modified,
            identical: data.identical,
            layout: data.rows ? data : previous?.original === original ? previous.layout : null,
          }));
          requested = null;
        }
        active = null;
        run();
      };
      worker.onerror = (event) => {
        event.preventDefault();
        fail(event.message || 'Markdown comparison failed');
      };
      worker.onmessageerror = () => fail('Invalid Markdown comparison result');
      worker.postMessage({ original });
    };
    const run = () => {
      if (active || !requested) return;
      try {
        if (!worker) open();
        active = requested;
        worker.postMessage(active);
      } catch (error) {
        fail(error);
      }
    };
    clientRef.current = (content) => {
      requested = content === original ? null : { modified: content };
      run();
    };
    return () => {
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.terminate();
      }
      clientRef.current = null;
    };
  }, [enabled, original]);

  useEffect(() => {
    if (enabled) clientRef.current?.(modified);
  }, [enabled, original, modified]);

  return enabled && result?.original === original ? result : null;
}
