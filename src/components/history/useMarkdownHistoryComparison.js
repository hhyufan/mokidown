import { useEffect, useRef, useState } from 'react';

const MAX_CACHED_COMPARISONS = 2;
const MAX_CACHED_SOURCE_LENGTH = 500_000;

export function useMarkdownHistoryComparison(
  original,
  modified,
  enabled,
  includeIdentical,
  attempt = 0,
) {
  const [result, setResult] = useState(null);
  const clientRef = useRef(null);
  const completed = useRef([]);
  const cached = enabled
    ? completed.current.find((entry) => entry.original === original && entry.modified === modified)
    : null;

  useEffect(() => {
    if (attempt > 0) setResult(null);
  }, [attempt]);

  useEffect(() => {
    if (!enabled) return undefined;
    let worker;
    let watchdog = 0;
    let inlineCompare = null;
    let loadingInline = false;
    let active = null;
    let requested = null;
    let hasResult = false;
    let disposed = false;
    const publish = (modified, data) => {
      const entry = {
        original,
        modified,
        identical: data.identical,
        layout: data.rows ? data : null,
      };
      if (entry.layout && original.length + modified.length <= MAX_CACHED_SOURCE_LENGTH) {
        completed.current = [
          entry,
          ...completed.current.filter(
            (item) => item.original !== original || item.modified !== modified,
          ),
        ].slice(0, MAX_CACHED_COMPARISONS);
      }
      setResult((previous) => {
        if (entry.layout || previous?.original !== original) return entry;
        return { ...entry, layout: previous.layout };
      });
    };
    const fail = (error) => {
      if (disposed) return;
      worker?.terminate();
      worker = null;
      inlineCompare = null;
      active = null;
      requested = null;
      setResult((previous) => ({
        original,
        layout: previous?.original === original ? previous.layout : null,
        error: String(error?.message || error),
        attempt,
      }));
    };
    const openInline = () => {
      if (loadingInline) return;
      loadingInline = true;
      import('./markdownHistoryComparison')
        .then(({ createMarkdownHistoryComparison }) => {
          if (disposed) return;
          inlineCompare = createMarkdownHistoryComparison(original);
          loadingInline = false;
          run();
        })
        .catch((error) => {
          loadingInline = false;
          fail(error);
        });
    };
    const open = () => {
      if (import.meta.env.DEV || typeof Worker === 'undefined') {
        openInline();
        return;
      }
      try {
        worker = new Worker(new URL('../../workers/markdownHistory.worker.js', import.meta.url), {
          type: 'module',
        });
      } catch {
        openInline();
        return;
      }
      const fallback = () => {
        clearTimeout(watchdog);
        worker?.terminate();
        worker = null;
        active = null;
        openInline();
      };
      // Worker 在个别环境里会静默不返回（模块加载失败但无 error 事件），
      // 超时后切到同线程计算，避免对比界面一直停在加载态。
      watchdog = setTimeout(() => {
        if (!hasResult) fallback();
      }, 1500);
      worker.onmessage = ({ data }) => {
        clearTimeout(watchdog);
        if (active && requested === active) {
          hasResult = true;
          publish(active.modified, data);
          requested = null;
        }
        active = null;
        run();
      };
      worker.onerror = (event) => {
        event.preventDefault();
        fallback();
      };
      worker.onmessageerror = fallback;
      worker.postMessage({ original });
    };
    const run = () => {
      if (disposed || active || !requested) return;
      if (!worker && !inlineCompare) {
        open();
        return;
      }
      if (!worker) {
        try {
          active = requested;
          const data = inlineCompare(active.modified);
          hasResult = true;
          publish(active.modified, data);
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
      const previous = completed.current.find(
        (entry) => entry.original === original && entry.modified === content,
      );
      if (previous) {
        requested = null;
        setResult(previous);
        return;
      }
      requested =
        content === original && !compareIdentical && !hasResult ? null : { modified: content };
      run();
    };
    return () => {
      disposed = true;
      clearTimeout(watchdog);
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.terminate();
      }
      clientRef.current = null;
    };
  }, [attempt, enabled, original]);

  useEffect(() => {
    if (enabled) clientRef.current?.(modified, includeIdentical);
  }, [attempt, enabled, original, modified, includeIdentical]);

  const current = enabled && result?.original === original;
  return cached ?? (current && (!result.error || result.attempt === attempt) ? result : null);
}
