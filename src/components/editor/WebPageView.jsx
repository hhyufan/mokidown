import { useTranslation } from 'react-i18next';
import { useLayoutEffect, useRef, useState } from 'react';
import { openExternal } from '@utils/tauriApi';
import { isImeComposing } from '@utils/keyboard';
import { parsePreviewAddress } from '@utils/previewAddress';
import usePreviewFrame from '@hooks/usePreviewFrame';
import NativeWebPage from './NativeWebPage';
import PreviewAddressButton from './PreviewAddressButton';
import './web-page.scss';

/**
 * 在编辑器内展示网页。Windows 使用同窗原生子视图，其它运行环境使用 iframe。
 *
 * @param {object} props 组件属性。
 * @param {string} props.url 网页地址。
 * @param {boolean} [props.active] 当前是否显示该视图。
 * @param {string} [props.className] 额外样式类。
 * @returns {JSX.Element} 网页视图。
 */
export default function WebPageView({
  url,
  initialLocation = url,
  active = true,
  className = '',
  moveLabel,
  onMove,
  onNavigate,
  onClose,
  onPage,
}) {
  const { t } = useTranslation();
  const frameRef = useRef(null);
  const [draft, setDraft] = useState(null);
  const [pageUrl, setPageUrl] = useState(initialLocation);
  const [frameSource, setFrameSource] = useState({ url: initialLocation, revision: 0 });
  const previousUrl = useRef(url);
  const [invalid, setInvalid] = useState(false);
  const useNativeView =
    Boolean(window.__TAURI_INTERNALS__) &&
    !window.AndroidBridge &&
    /Windows/i.test(navigator.userAgent);
  const syncPage = (location, icons) => {
    setPageUrl(location);
    onPage?.(location, icons);
  };
  const { syncFrameTheme, wallpaperProps } = usePreviewFrame(frameRef, {
    onNavigate,
    onPage: syncPage,
  });
  const address = draft ?? pageUrl;
  const openLocation = (location, reload = false) =>
    setFrameSource((previous) => ({ url: location, revision: previous.revision + 1, reload }));
  useLayoutEffect(() => {
    if (previousUrl.current === url) return;
    previousUrl.current = url;
    setDraft(null);
    setInvalid(false);
    setPageUrl(url);
    setFrameSource((previous) => ({ url, revision: previous.revision + 1 }));
  }, [url]);
  const refresh = () => openLocation(pageUrl, true);
  const submitAddress = (event) => {
    event.preventDefault();
    const target = parsePreviewAddress(address, pageUrl);
    setInvalid(!target);
    if (!target) return;
    setDraft(null);
    if (target.href === pageUrl) {
      refresh();
    } else {
      // A page can follow links without changing the URL that opened its tab.
      if (target.href === url) {
        setPageUrl(target.href);
        openLocation(target.href);
      }
      onNavigate(target.href);
    }
  };
  return (
    <div className={`web-page ${className}`} hidden={!active}>
      <div className="web-page__bar">
        <form className="preview-address" onSubmit={submitAddress}>
          <input
            aria-label={t('htmlPreview.address')}
            value={address}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={invalid || undefined}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
              setInvalid(false);
            }}
            onKeyDown={(event) => {
              if (isImeComposing(event)) {
                if (event.key === 'Enter') event.preventDefault();
                return;
              }
              if (event.key === 'Escape') {
                setDraft(null);
                setInvalid(false);
                event.currentTarget.blur();
              }
            }}
          />
          <PreviewAddressButton
            icon="copy"
            label={t('web.copyLink')}
            onClick={() => {
              void navigator.clipboard?.writeText(address).catch(() => {});
            }}
          />
          <PreviewAddressButton
            icon="refresh"
            label={t('htmlPreview.refresh')}
            onClick={() => {
              setDraft(null);
              setInvalid(false);
              refresh();
            }}
          />
        </form>
        <PreviewAddressButton icon="move" label={moveLabel} onClick={() => onMove(pageUrl)} />
        <PreviewAddressButton
          icon="external"
          label={t('web.openInBrowser')}
          onClick={() => {
            void openExternal(pageUrl).catch(() => {});
          }}
        />
        {onClose && (
          <PreviewAddressButton icon="close" label={t('web.closeSplit')} onClick={onClose} />
        )}
      </div>
      {invalid && (
        <div className="web-page__error" role="alert">
          {t('htmlPreview.invalidAddress')}
        </div>
      )}
      {useNativeView ? (
        <NativeWebPage
          url={frameSource.url}
          revision={frameSource.revision}
          reload={frameSource.reload}
          active={active}
          onPage={syncPage}
        />
      ) : (
        <div className="web-page__viewport preview-wallpaper" {...wallpaperProps}>
          <iframe
            key={frameSource.revision}
            ref={frameRef}
            onLoad={syncFrameTheme}
            className="web-page__frame"
            src={frameSource.url}
            title={pageUrl}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
            referrerPolicy="no-referrer"
          />
        </div>
      )}
    </div>
  );
}
