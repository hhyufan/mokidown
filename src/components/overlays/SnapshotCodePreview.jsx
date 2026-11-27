import { useEffect, useRef } from 'react';
import { computeIndentRainbowWidths, tokenizeSnapshotCode } from '@utils/snapshotExport';
import { reportRuntimeLog } from '@/services/runtimeLogs';

export default function SnapshotCodePreview({ code, language, options }) {
  const hostRef = useRef(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let cancelled = false;
    let instance;
    let resizeObserver;
    let contentSize;
    let animationFrame = 0;

    const mount = async () => {
      const [runtime, tokens] = await Promise.all([
        import('@utils/snapshotMonaco'),
        tokenizeSnapshotCode(code, language, options.dark),
        document.fonts?.ready,
      ]);
      await runtime.snapshotMonacoReady();
      if (cancelled) return;
      const indentWidths = options.showIndentRainbow
        ? computeIndentRainbowWidths(code.split(/\r\n?|\n/), options.tabSize)
        : [];
      instance = runtime.createSnapshotMonaco(host, { ...options, tokens, indentWidths });
      const { editor } = instance;
      const layout = () => {
        const width = host.clientWidth;
        if (!width) return;
        const height = Math.min(5600, editor.getContentHeight());
        if (host.clientHeight !== height) host.style.height = `${height}px`;
        if (editor.getLayoutInfo().width !== width || editor.getLayoutInfo().height !== height) {
          editor.layout({ width, height });
        }
      };
      const scheduleLayout = () => {
        if (animationFrame) return;
        animationFrame = requestAnimationFrame(() => {
          animationFrame = 0;
          layout();
        });
      };
      contentSize = editor.onDidContentSizeChange(scheduleLayout);
      resizeObserver = new ResizeObserver(scheduleLayout);
      resizeObserver.observe(host);
      layout();
    };

    void mount().catch((error) => {
      if (!cancelled) {
        reportRuntimeLog({ message: 'Failed to render screenshot code preview', detail: error });
      }
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      contentSize?.dispose();
      instance?.dispose();
    };
  }, [code, language, options]);

  return <div className="snapshot-card__code" ref={hostRef} />;
}
