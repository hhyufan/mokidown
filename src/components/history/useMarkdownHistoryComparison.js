import { useEffect, useRef, useState } from 'react';

export function useMarkdownHistoryComparison(original, modified, enabled, includeIdentical) {
  const [result, setResult] = useState(null);
  const clientRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let worker;
    let watchdog = 0;
    let inlineCompare = null;
    let active = null;
    let requested = null;
    let hasResult = false;
    const fail = (error) => {
      worker?.terminate();
      worker = null;
      inlineCompare = null;
      active = null;
      requested = null;
      setResult((previous) => ({
        original,
        layout: previous?.original === original ? previous.layout : null,
        error: String(error?.message || error),
      }));
    };
    const openInline = () => {
      import('./markdownHistoryComparison')
        .then(({ createMarkdownHistoryComparison }) => {
          inlineCompare = createMarkdownHistoryComparison(original);
          run();
        })
        .catch(fail);
    };
    const open = () => {
      if (import.meta.env.DEV || typeof Worker === 'undefined') {
        openInline();
        return;
      }
      worker = new Worker(new URL('../../workers/markdownHistory.worker.js', import.meta.url), {
        type: 'module',
      });
      // Worker 在个别环境里会静默不返回（模块加载失败但无 error 事件），
      // 超时后切到同线程计算，避免对比界面一直停在加载态。
      watchdog = setTimeout(() => {
        if (hasResult) return;
        worker?.terminate();
        worker = null;
        openInline();
      }, 1500);
      worker.onmessage = ({ data }) => {
        clearTimeout(watchdog);
        if (active && requested === active) {
          hasResult = true;
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
      if (!worker && !inlineCompare) {
        open();
        return;
      }
      if (!worker) {
        try {
          active = requested;
          const data = inlineCompare(active.modified);
          hasResult = true;
          const modified = active.modified;
          setResult((previous) => ({
            original,
            modified,
            identical: data.identical,
            layout: data.rows ? data : previous?.original === original ? previous.layout : null,
          }));
          active = null;
          requested = null;
          run();
        } catch (error) {
          fail(error);
        }
        return;
      }
      try {
        active = requested;
        worker.postMessage(active);
      } catch (error) {
        fail(error);
      }
    };
    clientRef.current = (content, compareIdentical) => {
      requested =
        content === original && !compareIdentical && !hasResult ? null : { modified: content };
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
    if (enabled) clientRef.current?.(modified, includeIdentical);
  }, [enabled, original, modified, includeIdentical]);

  return enabled && result?.original === original ? result : null;
}
