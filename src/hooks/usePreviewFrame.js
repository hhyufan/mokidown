import { useCallback, useEffect, useRef, useState } from 'react';
import useConfigStore from '@store/useConfigStore';
import useEditorStore from '@store/useEditorStore';
import { getBackgroundTransparency } from '@utils/backgroundImage';
import bridgeScript from '@utils/previewFrameBridge.js?raw';

export { bridgeScript as previewFrameBridgeScript };

/** Theme handshake works across origins; direct installation is a web fallback. */
export default function usePreviewFrame(iframeRef, { onNavigate, onPage, transparent = true } = {}) {
  const enabled = useConfigStore((state) => transparent && Boolean(state.backgroundEnabled && state.backgroundImage));
  const transparency = useConfigStore((state) => state.backgroundTransparency);
  const captureLinks = useConfigStore((state) => state.openLinksInEditor === true);
  const callbacks = useRef(null);
  callbacks.current = { onNavigate, onPage };
  const [pageTheme, setPageTheme] = useState(null);
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
    frame.contentWindow.postMessage({ type: 'mokidown:preview-theme', enabled, captureLinks }, '*');
  }, [enabled, captureLinks, iframeRef]);
  useEffect(() => {
    const initialFrame = iframeRef.current;
    const receive = (event) => {
      const frame = iframeRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const { type, scheme, theme } = event.data || {};
      if (type === 'mokidown:preview-ready') sync();
      if (type === 'mokidown:preview-page' && callbacks.current.onPage && Array.isArray(event.data.icons)) {
        // The reported address must belong to the document that sent it.
        const { url, icons } = event.data;
        if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
          try {
            if (new URL(url).origin === event.origin) callbacks.current.onPage(url, icons);
          } catch { /* Ignore malformed addresses. */ }
        }
      }
      if (type === 'mokidown:preview-link' && captureLinks && (navigator.userActivation?.isActive ?? true)) {
        const { url, mode, activate } = event.data;
        if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
        const editor = useEditorStore.getState();
        if (mode === 'current' && callbacks.current.onNavigate) callbacks.current.onNavigate(url);
        else if (mode === 'split') editor.openWebSplit(url);
        else if (mode === 'tab' || mode === 'current') editor.openWebTab(url, { activate: activate !== false });
      }
      if (type === 'mokidown:preview-scheme' && enabled && ['light', 'dark', 'light dark'].includes(scheme)
        && (theme === 'light' || theme === 'dark')) {
        frame.style.colorScheme = scheme;
        setPageTheme(theme);
      }
    };
    const preference = window.matchMedia?.('(prefers-color-scheme: dark)');
    const syncPreference = () => {
      iframeRef.current?.style.removeProperty('color-scheme');
      sync();
    };
    window.addEventListener('message', receive);
    preference?.addEventListener('change', syncPreference);
    syncPreference();
    return () => {
      initialFrame?.style.removeProperty('color-scheme');
      window.removeEventListener('message', receive);
      preference?.removeEventListener('change', syncPreference);
    };
  }, [enabled, captureLinks, iframeRef, sync]);
  return {
    syncFrameTheme: sync,
    wallpaperProps: enabled && pageTheme ? {
      'data-preview-theme': pageTheme,
      style: { '--moki-preview-wash': `${getBackgroundTransparency(transparency, pageTheme)}%` },
    } : {},
  };
}
