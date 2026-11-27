import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@utils/tauriInvoke';
import useConfigStore from '@store/useConfigStore';
import useFileStore from '@store/useFileStore';
import { isAndroidRuntime } from '@utils/platform';
import { isImeComposing } from '@utils/keyboard';
import { parsePreviewAddress } from '@utils/previewAddress';
import usePreviewFrame, { previewFrameBridgeScript } from '@hooks/usePreviewFrame';
import liveReloadClient from 'livereload-js/dist/livereload.min.js?raw';
import { htmlPreviewSizingScript } from './htmlPreviewSizing';
import PreviewAddressButton from './PreviewAddressButton';
import './html-preview.scss';

export default function HtmlPreview({
  source,
  filePath,
  title,
  compact = false,
  className = '',
  onReady,
}) {
  const { t } = useTranslation();
  const requestedPort = useConfigStore((state) => state.htmlPreviewPort ?? 0);
  const globalLiveReload = useConfigStore((state) => state.htmlPreviewLiveReload ?? true);
  // 地址栏上的关闭只临时停用当前预览的热更新，不改全局设置。
  // null 跟随全局设置；true/false 为当前预览栏的临时覆盖。
  const [liveOverride, setLiveOverride] = useState(null);
  const liveReload = liveOverride ?? globalLiveReload;
  const [menu, setMenu] = useState(null);
  const desktop =
    Boolean(window.__TAURI_INTERNALS__) && !window.AndroidBridge && !isAndroidRuntime();
  const hideBar = desktop && !liveReload;
  const root = useFileStore((state) => state.currentDir);
  // Desktop uses the same loopback origin in both modes so scripts and linked assets work.
  const native = desktop;
  const [frame, setFrame] = useState(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [address, setAddress] = useState('about:srcdoc');
  const [navigationUrl, setNavigationUrl] = useState(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (error) onReady?.();
  }, [error, onReady]);
  const sessionRef = useRef(null);
  const viewportRef = useRef(null);
  const iframeRef = useRef(null);
  const { syncFrameTheme, wallpaperProps } = usePreviewFrame(iframeRef, {
    onNavigate: (url) => {
      setNavigationUrl(url);
      setAddress(url);
      setError('');
    },
  });
  const injectSizing = (frame) => {
    try {
      const doc = frame?.contentDocument;
      if (!doc || doc.__mokiSizingInjected) return;
      doc.__mokiSizingInjected = true;
      const url = URL.createObjectURL(
        new Blob([htmlPreviewSizingScript], { type: 'text/javascript' }),
      );
      const script = doc.createElement('script');
      script.src = url;
      script.onload = () => URL.revokeObjectURL(url);
      doc.head.append(script);
    } catch {
      /* Cross-origin documents already get the script from the backend. */
    }
  };
  const scaleRef = useRef(1);
  const [contentWidth, setContentWidth] = useState(1280);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const latestSource = useRef(source);
  latestSource.current = source;

  useEffect(() => {
    const receive = (event) => {
      const frame = iframeRef.current;
      if (event.source !== frame?.contentWindow) return;
      if (event.data?.type === 'mokidown:html-preview-size') {
        const width = Number(event.data.width);
        if (Number.isFinite(width)) setContentWidth(Math.max(1280, Math.min(8192, width)));
        return;
      }
      if (event.data?.type === 'mokidown:preview-contextmenu') {
        const rect = frame.getBoundingClientRect();
        const scale = scaleRef.current || 1;
        setMenu({
          x: Math.min(rect.left + Number(event.data.x) * scale, window.innerWidth - 220),
          y: Math.min(rect.top + Number(event.data.y) * scale, window.innerHeight - 120),
        });
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);

  useLayoutEffect(() => {
    const element = viewportRef.current;
    const measure = () => {
      const { clientWidth: width, clientHeight: height } = element;
      if (width && height)
        setDimensions((previous) =>
          previous.width === width && previous.height === height ? previous : { width, height },
        );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setError('');
    setFrame(null);
    const session = {
      id: crypto.randomUUID(),
      closed: false,
      pending: false,
      dirty: false,
      timer: 0,
    };
    sessionRef.current = session;
    const close = () => invoke('html_preview_close', { id: session.id }).catch(() => {});
    session.flush = async (reload = false) => {
      if (session.closed) return;
      session.reload ||= reload;
      if (session.pending) {
        session.dirty = true;
        return;
      }
      const source = latestSource.current || '';
      const reloadFrame = session.reload;
      session.reload = false;
      if (!native) {
        setFrame({ html: source });
        if (reloadFrame) setRefresh((value) => value + 1);
        return;
      }
      session.pending = true;
      session.dirty = false;
      try {
        const result = await invoke('html_preview_update', {
          id: session.id,
          source,
          filePath: filePath || null,
          root: root || null,
          port: requestedPort,
          liveReload,
          clientScript: session.created
            ? null
            : `${previewFrameBridgeScript}\n${htmlPreviewSizingScript}${liveReload ? `\n${liveReloadClient}` : ''}`,
        });
        if (session.closed) return;
        if (!result?.url) throw new Error('Missing HTML preview address');
        session.created = true;
        setFrame((previous) =>
          previous?.sessionId === session.id &&
          previous.url === result.url &&
          previous.revision === result.revision
            ? previous
            : { ...result, sessionId: session.id },
        );
        if (reloadFrame) setRefresh((value) => value + 1);
        setError('');
      } catch (error) {
        if (!session.closed) {
          session.created = false;
          setFrame({ html: source });
          setError(String(error?.message || error));
        }
      } finally {
        session.pending = false;
        if (session.closed) void close();
        else if (session.dirty) void session.flush();
      }
    };
    void session.flush();
    return () => {
      session.closed = true;
      clearTimeout(session.timer);
      if (native && !session.pending) void close();
    };
  }, [filePath, liveReload, native, requestedPort, retry, root]);

  useEffect(() => {
    // 关闭热更新后不跟随源码自动刷新，只保留手动刷新。
    if (!liveReload) return undefined;
    const session = sessionRef.current;
    clearTimeout(session.timer);
    session.timer = setTimeout(() => {
      void session.flush();
    }, 140);
    return () => clearTimeout(session.timer);
  }, [source, liveReload]);

  useEffect(() => {
    setAddress(frame?.url || 'about:srcdoc');
    setNavigationUrl(null);
  }, [frame?.url]);

  const refreshPreview = () => {
    if (error || !frame) {
      setRetry((value) => value + 1);
      return;
    }
    // 关闭热更新时：重新提交当前内容并重载 iframe，让 HTML 与关联资源都取最新。
    if (!liveReload) {
      void sessionRef.current?.flush(true);
      return;
    }
    setRefresh((value) => value + 1);
  };
  useEffect(() => {
    if (!menu) return undefined;
    const closeMenu = (event) => {
      if (!event.target.closest('.html-preview__menu')) setMenu(null);
    };
    const clearMenu = () => setMenu(null);
    window.addEventListener('pointerdown', closeMenu, true);
    window.addEventListener('blur', clearMenu);
    return () => {
      window.removeEventListener('pointerdown', closeMenu, true);
      window.removeEventListener('blur', clearMenu);
    };
  }, [menu]);
  const label = title || t('htmlPreview.title');
  const width = Math.max(contentWidth, dimensions.width);
  const scale = dimensions.width ? Math.min(1, dimensions.width / width) : 1;
  scaleRef.current = scale;
  let url = navigationUrl ?? undefined;
  if (!url && frame?.url) {
    const location = new URL(frame.url);
    location.searchParams.set('__moki_preview', frame.sessionId);
    location.searchParams.set('revision', frame.revision);
    url = location.href;
  }
  return (
    <section
      className={`html-preview${compact ? ' html-preview--compact' : ''} ${className}`}
      aria-label={label}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({
          x: Math.min(event.clientX, window.innerWidth - 220),
          y: Math.min(event.clientY, window.innerHeight - 120),
        });
      }}
    >
      {!compact && (
        <header className={`html-preview__bar${hideBar ? ' html-preview__bar--collapsed' : ''}`}>
          <form
            className="preview-address"
            onSubmit={(event) => {
              event.preventDefault();
              if (address.trim() === 'about:srcdoc' && !frame?.url) {
                setNavigationUrl(null);
                return;
              }
              const target = parsePreviewAddress(address, frame?.url);
              if (!target) {
                setError(t('htmlPreview.invalidAddress'));
                return;
              }
              setNavigationUrl(target.href === frame?.url ? null : target.href);
              setAddress(target.href);
              setError('');
            }}
          >
            <input
              aria-label={t('htmlPreview.address')}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              spellCheck={false}
              autoComplete="off"
              onFocus={(event) => event.target.select()}
              onKeyDown={(event) => {
                if (isImeComposing(event)) {
                  if (event.key === 'Enter') event.preventDefault();
                  return;
                }
                if (event.key === 'Escape') {
                  setAddress(navigationUrl || frame?.url || 'about:srcdoc');
                  event.currentTarget.blur();
                }
              }}
            />
            <PreviewAddressButton
              icon="refresh"
              label={t('htmlPreview.refresh')}
              onClick={refreshPreview}
            />
          </form>
          {native && (
            <PreviewAddressButton
              icon="close"
              label={t('htmlPreview.disableLiveReload')}
              onClick={() => setLiveOverride(false)}
            />
          )}
        </header>
      )}
      {error && (
        <div className="html-preview__error" role="alert">
          {error}
        </div>
      )}
      <div
        className="html-preview__viewport preview-wallpaper"
        ref={viewportRef}
        {...wallpaperProps}
      >
        {frame && (
          <iframe
            ref={iframeRef}
            key={refresh}
            title={label}
            className="html-preview__frame"
            src={url}
            srcDoc={!url ? frame.html : undefined}
            onLoad={() => {
              setContentWidth(1280);
              syncFrameTheme();
              injectSizing(iframeRef.current);
              onReady?.();
            }}
            style={{
              width: Math.max(1, width),
              height: Math.max(1, dimensions.height / scale),
              transform: `scale(${scale})`,
            }}
            sandbox={
              url
                ? 'allow-scripts allow-forms allow-same-origin allow-downloads'
                : native
                  ? 'allow-scripts allow-forms'
                  : 'allow-scripts allow-forms allow-same-origin'
            }
            referrerPolicy="same-origin"
          />
        )}
      </div>
      {menu && (
        <div
          className="monaco-context-menu editor-context-menu html-preview__menu"
          role="menu"
          style={{ position: 'fixed', left: menu.x, top: menu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            className="monaco-context-menu__item editor-context-menu__item"
            onClick={() => {
              setLiveOverride(!liveReload);
              setMenu(null);
            }}
          >
            <span className="monaco-context-menu__label">
              {t(liveReload ? 'htmlPreview.disableLiveReload' : 'htmlPreview.enableLiveReload')}
            </span>
            <span className="monaco-context-menu__shortcut">
              {t(liveReload ? 'htmlPreview.localPreview' : 'htmlPreview.hotReload')}
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="monaco-context-menu__item editor-context-menu__item"
            onClick={() => {
              refreshPreview();
              setMenu(null);
            }}
          >
            <span className="monaco-context-menu__label">{t('htmlPreview.refresh')}</span>
          </button>
        </div>
      )}
    </section>
  );
}
