import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@utils/tauriInvoke';
import useConfigStore from '@store/useConfigStore';
import useFileStore from '@store/useFileStore';
import { isAndroidRuntime } from '@utils/platform';
import { isImeComposing } from '@utils/keyboard';
import usePreviewFrame, { previewFrameBridgeScript } from '@hooks/usePreviewFrame';
import liveReloadClient from 'livereload-js/dist/livereload.min.js?raw';
import { htmlPreviewSizingScript } from './htmlPreviewSizing';
import './html-preview.scss';

export default function HtmlPreview({ source, filePath, title, compact = false, className = '' }) {
  const { t } = useTranslation();
  const requestedPort = useConfigStore((state) => state.htmlPreviewPort ?? 0);
  const root = useFileStore((state) => state.currentDir);
  const native = Boolean(window.__TAURI_INTERNALS__) && !window.AndroidBridge && !isAndroidRuntime();
  const [frame, setFrame] = useState(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [address, setAddress] = useState('about:srcdoc');
  const [navigationUrl, setNavigationUrl] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const sessionRef = useRef(null);
  const viewportRef = useRef(null);
  const iframeRef = useRef(null);
  const syncFrameTheme = usePreviewFrame(iframeRef);
  const [contentWidth, setContentWidth] = useState(1280);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const latestSource = useRef(source);
  latestSource.current = source;

  useEffect(() => {
    const receive = (event) => {
      if (event.source !== iframeRef.current?.contentWindow || event.data?.type !== 'mokidown:html-preview-size') return;
      const width = Number(event.data.width);
      if (Number.isFinite(width)) setContentWidth(Math.max(1280, Math.min(8192, width)));
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);

  useLayoutEffect(() => {
    const element = viewportRef.current;
    const measure = () => {
      const { clientWidth: width, clientHeight: height } = element;
      if (width && height) setDimensions((previous) => previous.width === width && previous.height === height
        ? previous : { width, height });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setError('');
    setFrame(null);
    const session = { id: crypto.randomUUID(), closed: false, pending: false, dirty: false, timer: 0 };
    sessionRef.current = session;
    const close = () => invoke('html_preview_close', { id: session.id }).catch(() => {});
    session.flush = async () => {
      if (session.closed) return;
      if (session.pending) { session.dirty = true; return; }
      const source = latestSource.current || '';
      if (!native) { setFrame({ html: `${source}\n<script>${previewFrameBridgeScript}\n${htmlPreviewSizingScript}</script>` }); return; }
      session.pending = true;
      session.dirty = false;
      try {
        const result = await invoke('html_preview_update', {
          id: session.id, source, filePath: filePath || null, root: root || null, port: requestedPort,
          clientScript: session.created ? null : `${previewFrameBridgeScript}\n${htmlPreviewSizingScript}\n${liveReloadClient}`,
        });
        if (session.closed) return;
        session.created = true;
        setFrame((previous) => previous?.url === result.url && previous.revision === result.revision ? previous : result);
        setError('');
      } catch (error) {
        if (!session.closed) setError(String(error?.message || error));
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
  }, [filePath, native, requestedPort, retry, root]);

  useEffect(() => {
    const session = sessionRef.current;
    clearTimeout(session.timer);
    session.timer = setTimeout(() => { void session.flush(); }, 140);
    return () => clearTimeout(session.timer);
  }, [source]);

  useEffect(() => {
    setAddress(frame?.url || 'about:srcdoc');
    setNavigationUrl(null);
  }, [frame?.url]);

  const label = title || t('htmlPreview.title');
  const width = Math.max(contentWidth, dimensions.width);
  const scale = dimensions.width ? Math.min(1, dimensions.width / width) : 1;
  const url = navigationUrl || (frame?.url ? `${frame.url}?revision=${frame.revision}` : undefined);
  return <section className={`html-preview${compact ? ' html-preview--compact' : ''} ${className}`} aria-label={label}>
    {!compact && <header className="html-preview__bar">
      <form className="html-preview__address" onSubmit={(event) => {
        event.preventDefault();
        try {
          const input = address.trim();
          if (input === 'about:srcdoc' && !frame?.url) { setNavigationUrl(null); return; }
          const target = input.startsWith('/') && frame?.url ? new URL(input, frame.url)
            : new URL(/^https?:\/\//i.test(input) ? input : `http://${input}`);
          if (!['http:', 'https:'].includes(target.protocol)) return;
          setNavigationUrl(target.href);
          setAddress(target.href);
          setError('');
        } catch { setError(t('htmlPreview.invalidAddress')); }
      }}>
        <input aria-label={t('htmlPreview.address')} value={address} onChange={(event) => setAddress(event.target.value)}
          spellCheck={false} autoComplete="off" onFocus={(event) => event.target.select()} onKeyDown={(event) => {
            if (isImeComposing(event)) { if (event.key === 'Enter') event.preventDefault(); return; }
            if (event.key === 'Escape') { setAddress(navigationUrl || frame?.url || 'about:srcdoc'); event.currentTarget.blur(); }
          }} />
        <button type="button" aria-label={t('htmlPreview.refresh')} title={t('htmlPreview.refresh')} onClick={() => {
          if (error || !frame) setRetry((value) => value + 1);
          else setRefresh((value) => value + 1);
        }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 7v5h-5M20 12a8 8 0 1 0-2.3 5.7" />
        </svg></button>
      </form>
    </header>}
    {error && <div className="html-preview__error" role="alert">{error}</div>}
    <div className="html-preview__viewport" ref={viewportRef}>
      {frame && <iframe ref={iframeRef} key={refresh} title={label} className="html-preview__frame" src={url} srcDoc={!native && !navigationUrl ? frame.html : undefined}
        onLoad={() => { setContentWidth(1280); syncFrameTheme(); }}
        style={{ width: Math.max(1, width), height: Math.max(1, dimensions.height / scale), transform: `scale(${scale})` }}
        sandbox={url ? 'allow-scripts allow-forms allow-same-origin allow-downloads' : 'allow-scripts allow-forms'}
        referrerPolicy="same-origin" />}
    </div>
  </section>;
}
