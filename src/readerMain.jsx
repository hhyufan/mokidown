import { createElement, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { StyleProvider } from '@ant-design/cssinjs';
import { useTranslation } from 'react-i18next';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@utils/tauriInvoke';
import { announceMainWindowReady } from '@utils/startupHandover';
import useConfigStore from '@store/useConfigStore';
import useThemeStore from '@store/useThemeStore';
import { useBackgroundImage } from '@hooks/useBackgroundImage';
import { useBackgroundSurfaces } from '@hooks/useBackgroundSurfaces';
import { getBackgroundTransparency } from '@utils/backgroundImage';
import { buildReaderZoomUpdate } from '@/services/readerZoom';
import ReadOnlyMarkdown from '@components/editor/ReadOnlyMarkdown';
import FileTypeIcon from '@components/ui/FileTypeIcon';
import WindowPinIcon from '@components/ui/WindowPinIcon';
import ReaderFooter from '@components/layout/footer/ReaderFooter';
import { createDragPreviewElement } from '@/services/dragPreviewElement';
import { expandReader } from '@/services/readerOpening';
import { subscribeReaderDocuments } from '@/services/readerDocumentSession';
import ThemedConfigProvider from '@/antd/ThemedConfigProvider';
import RuntimeLogHost from '@components/overlays/RuntimeLogDialog';
import RuntimeErrorBoundary from '@components/overlays/RuntimeErrorBoundary';
import { installRuntimeLogging } from '@/services/runtimeLogs';
import { readFileContent } from '@utils/tauriApi';
import useNotificationStore from '@store/useNotificationStore';
import TaskList from '@components/overlays/TaskList';
import './i18n';
import './assets/styles/index.scss';
import './reader.scss';
import './assets/styles/antd-overrides.scss';

const stopRuntimeLogging = installRuntimeLogging();
if (import.meta.hot) import.meta.hot.dispose(stopRuntimeLogging);

const ReaderSourceEditor = lazy(() => import('@components/editor/ReaderSourceEditor'));

function OpeningTitle({ preview }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    // 同一份快照保留图标、字重、边框占位和内边距，交接时不重新排版。
    const card = createDragPreviewElement(preview);
    // 快照包含计算后的逻辑定位；清除它们，避免覆盖 left/top。
    for (const property of Array.from(card.style)) {
      if (/^(inset($|-)|top$|right$|bottom$|left$|margin($|-))/.test(property)) card.style.removeProperty(property);
    }
    Object.assign(card.style, {
      position: 'relative', left: '0', top: '0', margin: '0', transform: 'none',
      width: 'max-content', minWidth: 'max-content', maxWidth: 'none', overflow: 'visible',
      background: 'transparent', borderColor: 'transparent', boxShadow: 'none',
    });
    for (const label of card.querySelectorAll('span')) {
      Object.assign(label.style, {
        width: 'max-content', minWidth: 'max-content', maxWidth: 'none',
        overflow: 'visible', textOverflow: 'clip', flexShrink: '0',
      });
    }
    ref.current.replaceChildren(card);
  }, [preview]);
  return <span ref={ref} className="reader__title-snapshot" aria-label={preview.name} />;
}

function ReaderBackground({ enabled, imageUrl, opacity }) {
  useBackgroundSurfaces({ enabled, imageUrl, opacity, workspaceSelector: '#root' });
  useLayoutEffect(() => {
    document.body.classList.toggle('moki-has-background', enabled);
    return () => document.body.classList.remove('moki-has-background');
  }, [enabled]);
  return null;
}

export function ReaderWindow({ document: documentInfo, onNavigate, staged = false, onPrepared, backgroundManaged = false, sharedBackgroundUrl }) {
  const { t } = useTranslation();
  const [content, setContent] = useState(documentInfo.content || '');
  const [metadata, setMetadata] = useState({
    encoding: documentInfo.encoding, lineEnding: documentInfo.lineEnding,
  });
  const [position, setPosition] = useState({ lineNumber: 1, column: 1 });
  const [loading, setLoading] = useState(documentInfo.content == null);
  const [error, setError] = useState('');
  const [returning, setReturning] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [opening, setOpening] = useState(Boolean(documentInfo.opening));
  const [covered, setCovered] = useState(Boolean(documentInfo.opening));
  const [prepared, setPrepared] = useState(null);
  const [activated, setActivated] = useState(!documentInfo.prerender);
  const [contentReady, setContentReady] = useState(false);
  const [layoutPrepared, setLayoutPrepared] = useState(false);
  const presented = useRef(false);
  const markContentReady = useCallback(() => setContentReady(true), []);
  const rootRef = useRef(null);
  const activationRevision = useRef(0);
  const activationListening = useRef(Promise.resolve());
  const config = useConfigStore();
  const theme = useThemeStore((state) => state.theme);
  const dark = theme === 'dark';
  const isMarkdown = /\.(md|markdown|mdown|mdwn|mkd|mkdn|mdx)$/i.test(documentInfo.name);
  const native = Boolean(window.__TAURI_INTERNALS__);
  const { url: localBackgroundUrl } = useBackgroundImage();
  const backgroundUrl = backgroundManaged ? sharedBackgroundUrl : localBackgroundUrl;
  const hasBackground = (!opening || Boolean(prepared)) && config.backgroundEnabled && Boolean(backgroundUrl);
  const fontSize = config.previewZoomSync ? config.fontSize : config.previewFontSize;
  const lineHeight = config.previewZoomSync ? config.lineHeight : config.previewLineHeight;

  useLayoutEffect(() => {
    if (!documentInfo.opening) return undefined;
    document.documentElement.classList.add('reader-transparent-host');
    return () => document.documentElement.classList.remove('reader-transparent-host');
  }, [documentInfo.opening]);

  useEffect(() => {
    if (!native || !documentInfo.prerender) return undefined;
    let cancelled = false;
    // Register before bootstrap/ready so dropping during warm-up cannot lose activation.
    const subscription = listen('reader:activate', async () => {
      activationRevision.current += 1;
      try {
        const geometry = await invoke('reader_ready');
        if (!cancelled) { setPrepared(geometry); setActivated(true); }
      } catch (failure) {
        if (!cancelled) { setError(String(failure)); setOpening(false); setCovered(false); }
      }
    });
    activationListening.current = subscription;
    return () => {
      cancelled = true;
      void subscription.then((stop) => stop()).catch(() => {});
    };
  }, [native, documentInfo.prerender]);

  useEffect(() => {
    if (staged) return undefined;
    const reader = rootRef.current;
    if (!reader) return undefined;
    let wheelAccumulator = 0;
    let resetTimer = null;
    const handleWheel = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      wheelAccumulator += event.deltaY;
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => { wheelAccumulator = 0; resetTimer = null; }, 250);
      if (Math.abs(wheelAccumulator) < 24) return;
      const step = wheelAccumulator > 0 ? -1 : 1;
      wheelAccumulator = 0;
      const state = useConfigStore.getState();
      const update = buildReaderZoomUpdate(isMarkdown ? state : { ...state, previewZoomSync: true }, step);
      if (!isMarkdown && !state.previewZoomSync) {
        delete update.previewFontSize;
        delete update.previewLineHeight;
      }
      Object.entries(update).forEach(([key, value]) => state.setConfig(key, value));
    };
    reader.addEventListener('wheel', handleWheel, { capture: true, passive: false });
    return () => {
      if (resetTimer) clearTimeout(resetTimer);
      reader.removeEventListener('wheel', handleWheel, true);
    };
  }, [isMarkdown, staged]);

  useEffect(() => {
    let cancelled = false;
    let revision = 0;
    const subscriptions = [];
    const reload = async () => {
      if (!documentInfo.path || documentInfo.modified) { setLoading(false); return; }
      const request = ++revision;
      try {
        const result = await readFileContent(documentInfo.path);
        if (cancelled || request !== revision) return;
        if (!result.success) throw new Error(result.message);
        setContent(result.content || '');
        setMetadata({ encoding: result.encoding, lineEnding: result.line_ending });
        setError('');
      } catch (failure) {
        if (!cancelled && request === revision) setError(failure.message || String(failure));
      } finally {
        if (!cancelled && request === revision) setLoading(false);
      }
    };
    if (documentInfo.content == null) void reload();
    if (native && documentInfo.path && !documentInfo.modified) {
      // Shared native watchers remain owned by the process, not a reader closing on another monitor.
      subscriptions.push(listen('file-changed', (event) => {
        const path = typeof event.payload === 'string' ? event.payload : event.payload?.path;
        if (path === documentInfo.path) void reload();
      }));
      void invoke('start_file_watching', { filePath: documentInfo.path }).catch(() => {});
      window.addEventListener('focus', reload);
    }
    return () => {
      cancelled = true;
      window.removeEventListener('focus', reload);
      subscriptions.forEach((subscription) => { void subscription.then((stop) => stop()).catch(() => {}); });
    };
  }, [documentInfo, native]);

  useEffect(() => {
    if (!native || staged) { setOpening(false); setLayoutPrepared(true); return undefined; }
    const current = getCurrentWindow();
    void current.setTitle(`${documentInfo.name} - MokiDown`).catch(() => {});
    if (current.label === 'main') {
      setOpening(false);
      setLayoutPrepared(true);
      return undefined;
    }
    const controller = new AbortController();
    const { signal } = controller;
    const revision = activationRevision.current;
    // 布局准备与文件读取并行；字体仍由正文就绪检查等待。
    void (async () => {
      await activationListening.current;
      signal.throwIfAborted();
      const geometry = await invoke('reader_ready');
      signal.throwIfAborted();
      if (activationRevision.current !== revision) return;
      setLayoutPrepared(true);
      if (geometry && documentInfo.opening) {
        // Keep the reader hidden while React mounts content at the final viewport size.
        setPrepared(geometry);
        if (geometry.activated) setActivated(true);
        return;
      }
      if (!signal.aborted) { setOpening(false); setCovered(false); }
    })().catch(async (failure) => {
      if (signal.aborted) return;
      setOpening(false);
      setCovered(false);
      setError(String(failure));
      setLayoutPrepared(true);
    });
    return () => controller.abort();
  }, [native, documentInfo.name, documentInfo.opening, staged]);

  useEffect(() => {
    if (staged && layoutPrepared && !loading && (contentReady || error)) onPrepared?.();
  }, [staged, layoutPrepared, loading, contentReady, error, onPrepared]);

  useEffect(() => {
    if (staged) return undefined;
    if (!activated || !layoutPrepared || loading || opening || (!contentReady && !error) || presented.current) return undefined;
    presented.current = true;
    window.__mokiRuntimeLogs?.ready();
    if (!native) return undefined;
    const current = getCurrentWindow();
    if (current.label === 'main') return announceMainWindowReady(Promise.resolve());
    // 正文与底栏已提交到 DOM，原生窗口此时才允许显示。
    void invoke('reader_present', { focus: true }).then(() => {
      if (documentInfo.opening) return invoke('close_drag_preview', { token: documentInfo.opening.preview.token });
      return undefined;
    }).catch((failure) => setError(String(failure)));
    return undefined;
  }, [activated, layoutPrepared, loading, opening, contentReady, error, native, documentInfo.opening, staged]);

  useEffect(() => {
    if (!activated || !prepared || loading || !covered || !contentReady) return undefined;
    const controller = new AbortController();
    // Reveal the already-rendered document directly, with no full-size blank cover.
    void expandReader(rootRef.current, documentInfo.opening.preview, prepared, controller.signal,
      hasBackground ? backgroundUrl : null)
      .catch(async (failure) => {
        if (controller.signal.aborted) return;
        setError(String(failure));
        await invoke('reader_present', { focus: false }).catch(() => {});
        await invoke('close_drag_preview', { token: documentInfo.opening.preview.token }).catch(() => {});
      })
      .then(() => {
        if (controller.signal.aborted) return;
        setOpening(false);
        setCovered(false);
        presented.current = true;
        if (native) void invoke('reader_present', { focus: true }).catch(() => {});
      });
    return () => controller.abort();
  }, [activated, prepared, loading, covered, isMarkdown, contentReady, hasBackground, backgroundUrl, native, documentInfo.opening]);

  useEffect(() => {
    if (!native || opening) return undefined;
    const current = getCurrentWindow();
    const refresh = () => { void current.isMaximized().then(setMaximized).catch(() => {}); };
    refresh();
    const subscription = current.onResized(refresh);
    return () => { void subscription.then((stop) => stop()).catch(() => {}); };
  }, [native, opening]);

  const control = async (action) => {
    try { await action(getCurrentWindow()); } catch (failure) { setError(failure.message || String(failure)); }
  };
  const returnToEditor = async () => {
    setReturning(true);
    try {
      if (native) await invoke('reader_return_to_editor');
      else location.assign(location.pathname);
    } catch (failure) {
      setReturning(false);
      setError(failure.message || String(failure));
    }
  };
  const button = (label, onClick, icon, className = '', pressed) => <button type="button" className={`reader__button ${className}`} aria-label={label} aria-pressed={pressed} title={label} onClick={onClick}>{icon}</button>;
  const svg = (children) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;

  const preview = documentInfo.opening?.preview;
  return <main ref={rootRef} aria-hidden={staged || undefined} className={`reader${staged ? ' reader--staged' : ''}${hasBackground ? ' reader--background' : ''}${opening ? ' reader--opening' : ''}${covered ? ' reader--covered' : ''}${loading || (!contentReady && !error) ? ' reader--pending' : ''}`}
    style={{
      ...(hasBackground ? {
        '--moki-background-image': `url(${JSON.stringify(backgroundUrl)})`,
        '--moki-background-opacity': (100 - getBackgroundTransparency(config.backgroundTransparency, theme)) / 100,
      } : {}),
      ...(preview ? {
      '--reader-title-font': preview.appearance.fontFamily,
      '--reader-title-size': preview.appearance.fontSize,
      '--reader-title-gap': preview.appearance.gap,
      '--reader-title-padding': preview.appearance.paddingLeft,
      '--reader-opening-header': `${preview.height}px`,
      '--reader-opening-background': preview.background,
      } : {}),
    }}>
    {!backgroundManaged && !staged && <ReaderBackground enabled={hasBackground} imageUrl={backgroundUrl}
      opacity={(100 - getBackgroundTransparency(config.backgroundTransparency, theme)) / 100} />}
    <header className="reader__header">
      <div className="reader__title" onMouseDown={(event) => {
        if (!native || event.button !== 0) return;
        event.preventDefault();
        void control((current) => event.detail === 2 ? (maximized ? current.unmaximize() : current.maximize()) : current.startDragging());
      }} onContextMenu={(event) => event.preventDefault()}>
        {preview ? <OpeningTitle preview={preview} /> : <>
          <FileTypeIcon fileName={documentInfo.name} size={16} />
          <span className="reader__filename" title={documentInfo.name}>{documentInfo.name}</span>
        </>}
        <small>{t('reader.readOnly')}</small>
      </div>
      <button type="button" className="reader__home" aria-label={t('reader.returnToEditor')} title={t('reader.returnToEditor')} disabled={returning} onClick={returnToEditor}>
        {svg(<><path d="m9 10-5 5 5 5" /><path d="M4 15h10a6 6 0 0 0 0-12h-3" /></>)}
      </button>
      {native && <div className="reader__controls">
        {button(pinned ? t('topbar.unpin') : t('topbar.pin'), () => control(async (current) => {
          await current.setAlwaysOnTop(!pinned); setPinned(!pinned);
        }), <WindowPinIcon pinned={pinned} />, pinned ? 'is-active' : '', pinned)}
        {button(t('topbar.minimize'), () => control((current) => current.minimize()), svg(<path d="M5 12h14" />))}
        {button(maximized ? t('topbar.unmaximize') : t('topbar.maximize'), () => control((current) => maximized ? current.unmaximize() : current.maximize()), svg(<rect x="3" y="3" width="18" height="18" rx="2" />))}
        {button(t('topbar.close'), () => control((current) => current.close()), svg(<path d="m6 6 12 12M18 6 6 18" />), 'reader__button--close')}
      </div>}
    </header>
    {error && <div className="reader__message" role="alert">{error}</div>}
    {opening && !prepared ? <div className="reader__opening-space" aria-hidden="true" />
      : loading ? null
      : isMarkdown
        ? <ReadOnlyMarkdown content={content} documentPath={documentInfo.path} dark={dark}
            fontSize={fontSize || 14} lineHeight={lineHeight || 24} onReady={markContentReady} />
        : <Suspense fallback={null}>
          <ReaderSourceEditor document={documentInfo} content={content} dark={dark} config={config}
            onReady={markContentReady} onPositionChange={setPosition} />
        </Suspense>}
    <ReaderFooter document={{ ...documentInfo, ...metadata }} content={content} position={position}
      onOpenFile={onNavigate} />
  </main>;
}

export function ReaderHost({ document: initialDocument }) {
  const { t } = useTranslation();
  const config = useConfigStore();
  const theme = useThemeStore((state) => state.theme);
  const { url: backgroundUrl } = useBackgroundImage();
  const [session, setSession] = useState({ document: initialDocument, version: 0 });
  const [pending, setPending] = useState(null);
  const version = useRef(0);
  const navigation = useRef(0);
  useEffect(() => {
    // WebView 的模块与日志界面已挂载；预热正文仍由独立 ready/present 门禁控制。
    window.__mokiRuntimeLogs?.ready();
    return () => { navigation.current += 1; };
  }, []);
  const navigate = useCallback(async (file) => {
    const revision = ++navigation.current;
    const result = await readFileContent(file.path);
    if (revision !== navigation.current) return;
    if (!result.success) {
      useNotificationStore.getState().notify(result.blockedReason ? 'warning' : 'error',
        t('notification.error'), result.message);
      return;
    }
    const document = {
      id: file.path, path: file.path, name: file.name, content: result.content || '',
      encoding: result.encoding, lineEnding: result.line_ending,
    };
    await invoke('reader_replace_document', { document });
    if (revision === navigation.current) setPending({ document, version: ++version.current });
  }, [t]);
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return undefined;
    const controller = new AbortController();
    void subscribeReaderDocuments((document) => setSession((previous) => {
      const old = previous.document;
      if (old.id === document.id && old.path === document.path && old.content === document.content
        && old.prerender === document.prerender && old.opening?.preview.token === document.opening?.preview.token) return previous;
      // Reset per-document effects and readiness without reloading the WebView.
      navigation.current += 1;
      setPending(null);
      return { document, version: ++version.current };
    }), controller.signal).catch(console.error);
    return () => controller.abort();
  }, []);
  return <>
    <ReaderBackground enabled={config.backgroundEnabled && Boolean(backgroundUrl)} imageUrl={backgroundUrl}
      opacity={(100 - getBackgroundTransparency(config.backgroundTransparency, theme)) / 100} />
    {[session, pending].filter(Boolean).map((item) =>
    <ReaderWindow key={item.version} document={item.document} onNavigate={navigate} backgroundManaged sharedBackgroundUrl={backgroundUrl}
      staged={item !== session} onPrepared={() => {
        setSession(item);
        setPending(null);
      }} />)}
  </>;
}

export function mountReader(document) {
  ReactDOM.createRoot(window.document.getElementById('root')).render(
    <StyleProvider hashPriority="high">
      <ThemedConfigProvider>
        <RuntimeLogHost />
        <TaskList reader />
        <RuntimeErrorBoundary root>{createElement(ReaderHost, { document })}</RuntimeErrorBoundary>
      </ThemedConfigProvider>
    </StyleProvider>
  );
}
