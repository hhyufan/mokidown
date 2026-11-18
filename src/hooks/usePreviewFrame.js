import { useCallback, useEffect, useRef } from 'react';
import useConfigStore from '@store/useConfigStore';
import bridgeScript from '@utils/previewFrameBridge.js?raw';

export { bridgeScript as previewFrameBridgeScript };

/** Theme handshake works across origins; direct installation is a web fallback. */
export default function usePreviewFrame(iframeRef) {
  const enabled = useConfigStore((state) => Boolean(state.backgroundEnabled && state.backgroundImage));
  const settings = useRef(null);
  settings.current = { type: 'mokidown:preview-theme', enabled, opacity: 0.38 };
  const sync = useCallback(() => {
    const frame = iframeRef.current;
    if (!frame?.contentWindow) return;
    try {
      // Same-origin pages can also work in a regular browser. Cross-origin
      // documents receive the identical bridge from the native WebView2 hook.
      const document = frame.contentDocument;
      if (document && !frame.contentWindow.__mokiPreviewBridge) {
        const script = document.createElement('script');
        script.textContent = bridgeScript;
        (document.head || document.documentElement).append(script);
      }
    } catch { /* Cross-origin access is intentionally delegated to WebView2. */ }
    frame.contentWindow.postMessage(settings.current, '*');
  }, [iframeRef]);
  useEffect(() => {
    const receive = (event) => {
      if (event.source === iframeRef.current?.contentWindow && event.data?.type === 'mokidown:preview-ready') sync();
    };
    window.addEventListener('message', receive);
    sync();
    return () => window.removeEventListener('message', receive);
  }, [enabled, iframeRef, sync]);
  return sync;
}
