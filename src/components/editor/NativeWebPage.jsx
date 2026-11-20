import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Channel } from '@tauri-apps/api/core';
import useConfigStore from '@store/useConfigStore';
import useEditorStore from '@store/useEditorStore';
import { invoke } from '@utils/tauriInvoke';
import { openExternal } from '@utils/tauriApi';
import { getBackgroundTransparency, readBackgroundImage } from '@utils/backgroundImage';
import { MONACO_POPUPS } from '@hooks/useBackgroundSurfaces';

// A sibling HWND sits above DOM content. Hide it while an editor popup covers its area.
const OVERLAYS = [
  '.ant-modal-mask',
  '.ant-modal-wrap',
  '.ant-drawer-content-wrapper',
  '.ant-dropdown-menu',
  '.ant-select-dropdown',
  '.ant-popover-inner',
  '.ant-tooltip-inner',
  '.search-dropdown__panel',
  '.monaco-context-menu',
  '.footer__dropdown',
  '.task-panel',
  '.notif',
  '.external-file-notice',
  MONACO_POPUPS,
].join(',');
const LOAD_TIMEOUT_MS = 25000;
let wallpaperCache;

function previewWallpaper(id) {
  if (wallpaperCache?.id === id) return wallpaperCache.image;
  const image = readBackgroundImage(id).then(async (blob) => {
    if (!blob) return null;
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/webp', 0.9).split(',')[1];
    } finally {
      bitmap.close();
    }
  });
  wallpaperCache = { id, image };
  void image.catch(() => {
    if (wallpaperCache?.image === image) wallpaperCache = null;
  });
  return image;
}

function isCovered(rect) {
  return [...document.querySelectorAll(OVERLAYS)].some((element) => {
    const box = element.getBoundingClientRect();
    if (
      box.width <= 0 ||
      box.height <= 0 ||
      box.right <= rect.left ||
      box.left >= rect.right ||
      box.bottom <= rect.top ||
      box.top >= rect.bottom
    )
      return false;
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  });
}

function measureBounds(element, ready, enabled) {
  const box = element.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const x = Math.round(box.left * ratio);
  const y = Math.round(box.top * ratio);
  const workspace = element.closest('.editor-content__workspace')?.getBoundingClientRect();
  let wallpaper = null;
  if (enabled) {
    const styles = getComputedStyle(document.documentElement);
    const [width, height] = styles
      .getPropertyValue('--moki-background-size')
      .trim()
      .split(/\s+/)
      .map(parseFloat);
    const left = parseFloat(styles.getPropertyValue('--moki-background-x'));
    const top = parseFloat(styles.getPropertyValue('--moki-background-y'));
    if (width > 0 && height > 0 && Number.isFinite(left) && Number.isFinite(top)) {
      wallpaper = {
        x: Math.round(left * ratio) - x,
        y: Math.round(top * ratio) - y,
        width: Math.round(width * ratio),
        height: Math.round(height * ratio),
      };
    }
  }
  return {
    x,
    y,
    width: Math.round(box.right * ratio) - x,
    height: Math.round(box.bottom * ratio) - y,
    client: {
      width: Math.round(window.innerWidth * ratio),
      height: Math.round(window.innerHeight * ratio),
      fillsBottom: Boolean(workspace && Math.abs(box.bottom - workspace.bottom) < 1),
    },
    wallpaper,
    visible:
      ready &&
      box.width > 0 &&
      box.height > 0 &&
      element.getClientRects().length > 0 &&
      !document.hidden &&
      !isCovered(box),
  };
}

export default function NativeWebPage({ url, active, onPage }) {
  const { t } = useTranslation();
  const viewport = useRef(null);
  const scheduleLayout = useRef(null);
  const activeSession = useRef(null);
  const wallpaperId = useConfigStore(
    (state) => (state.backgroundEnabled && state.backgroundImage) || null,
  );
  const wallpaperEnabled = Boolean(wallpaperId);
  const transparency = useConfigStore((state) => state.backgroundTransparency);
  const appearance = useRef(null);
  appearance.current = {
    enabled: wallpaperEnabled,
    light: getBackgroundTransparency(transparency, 'light'),
    dark: getBackgroundTransparency(transparency, 'dark'),
  };
  const onPageRef = useRef(onPage);
  onPageRef.current = onPage;
  const [state, setState] = useState({ type: 'loading' });

  useLayoutEffect(() => {
    const element = viewport.current;
    const id = crypto.randomUUID();
    const events = new Channel();
    let disposed = false;
    let failed = false;
    let ready = false;
    let opened = false;
    let applying = false;
    let layoutPending = false;
    let frame = 0;
    let lastBounds = '';
    let failedNavigation = -1;
    let presenting = false;
    let activation = 0;

    const update = () => {
      frame = 0;
      if (!opened || disposed || !presenting) return;
      if (applying) {
        layoutPending = true;
        return;
      }
      layoutPending = false;
      const appearanceOptions = appearance.current;
      const bounds = measureBounds(element, ready, appearanceOptions.enabled);
      const key = JSON.stringify({ bounds, appearance: appearanceOptions });
      if (key === lastBounds) return;
      lastBounds = key;
      applying = true;
      void invoke('native_web_preview_layout', {
        id,
        bounds,
        appearance: appearanceOptions,
        activation,
      })
        .catch(fail)
        .finally(() => {
          applying = false;
          if (layoutPending && !frame) update();
        });
    };
    const schedule = () => {
      if (!frame && !disposed && presenting) frame = requestAnimationFrame(update);
    };
    scheduleLayout.current = schedule;
    const fail = (error) => {
      if (disposed || failed) return;
      failed = true;
      clearTimeout(loadTimeout);
      opened = false;
      ready = false;
      setState({ type: 'error', message: String(error?.message || error) });
      void invoke('native_web_preview_close', { id }).catch(() => {});
    };
    const loadTimeout = setTimeout(() => {
      setState({ type: 'error', timedOut: true });
    }, LOAD_TIMEOUT_MS);

    events.onmessage = (event) => {
      if (disposed || failed) return;
      if (event.type === 'page') onPageRef.current?.(event.url, event.icons);
      if (event.type === 'error') fail(event.message);
      if (event.type === 'contentReady' && event.navigationId !== failedNavigation) {
        clearTimeout(loadTimeout);
        ready = true;
        setState({ type: 'ready' });
        schedule();
      }
      if (event.type === 'navigation' && !event.success) {
        clearTimeout(loadTimeout);
        failedNavigation = event.navigationId;
        ready = false;
        setState({ type: 'error', status: event.status, code: event.code });
        schedule();
      }
      if (event.type === 'popup') {
        if (useConfigStore.getState().openLinksInEditor)
          useEditorStore.getState().openWebTab(event.url);
        else void openExternal(event.url).catch(() => {});
      }
    };

    setState({ type: 'loading' });
    const opening = invoke('native_web_preview_open', {
      id,
      url,
      bounds: measureBounds(element, false, appearance.current.enabled),
      appearance: appearance.current,
      events,
    }).then(() => {
      if (!disposed && !failed) {
        opened = true;
        schedule();
      }
    }, fail);
    const setActive = (next) => {
      if (presenting === next) return;
      presenting = next;
      activation += 1;
      lastBounds = '';
      if (next) {
        schedule();
      } else if (opened) {
        // Hide independently of any geometry update still in flight.
        void invoke('native_web_preview_hide', { id, activation }).catch(fail);
      }
    };
    activeSession.current = { id, opening, setActive };
    const resize = new ResizeObserver(() => {
      if (frame) cancelAnimationFrame(frame);
      update();
    });
    resize.observe(element);
    const overlays = new MutationObserver(schedule);
    overlays.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
    });
    overlays.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    window.addEventListener('resize', schedule);
    document.addEventListener('scroll', schedule, true);
    document.addEventListener('visibilitychange', schedule);
    return () => {
      disposed = true;
      scheduleLayout.current = null;
      activeSession.current = null;
      clearTimeout(loadTimeout);
      events.onmessage = () => {};
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      overlays.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('scroll', schedule, true);
      document.removeEventListener('visibilitychange', schedule);
      const close = () => invoke('native_web_preview_close', { id });
      void (opened ? close() : opening.then(close)).catch(() => {});
    };
  }, [url]);
  useLayoutEffect(() => {
    activeSession.current?.setActive(active);
  }, [url, active]);
  useLayoutEffect(() => {
    scheduleLayout.current?.();
  }, [wallpaperEnabled, transparency]);
  useEffect(() => {
    const session = activeSession.current;
    if (!session) return undefined;
    let cancelled = false;
    const image = wallpaperId ? previewWallpaper(wallpaperId) : Promise.resolve(null);
    void Promise.all([session.opening, image])
      .then(([, data]) => {
        if (!cancelled)
          return invoke('native_web_preview_wallpaper', { id: session.id, image: data });
        return undefined;
      })
      .catch((error) => {
        if (!cancelled) console.warn('Could not prepare the preview wallpaper', error);
      });
    return () => {
      cancelled = true;
    };
  }, [url, wallpaperId]);

  return (
    <div className="web-page__viewport web-page__native preview-wallpaper" ref={viewport}>
      {state.type === 'loading' && <span role="status">{t('web.loading')}</span>}
      {state.type === 'error' && (
        <div className="web-page__native-error" role="alert">
          <strong>{t('web.loadFailed')}</strong>
          <span>
            {state.timedOut
              ? t('web.loadTimeout')
              : state.message ||
                (state.status > 0 ? `HTTP ${state.status}` : `WebView2 ${state.code}`)}
          </span>
        </div>
      )}
    </div>
  );
}
