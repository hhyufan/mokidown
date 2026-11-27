import { useMemo, useRef, useState } from 'react';
import { Button, Segmented, Slider, Switch, Tooltip } from 'antd';
import { CameraOutlined, CloseOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { getBackgroundTransparency } from '@utils/backgroundImage';
import { useStageMaxCardWidth } from '@hooks/useStageMaxCardWidth';
import { DEFAULT_SNAPSHOT_PREFS } from '@store/useSnapshotStore';
import {
  SNAPSHOT_BACKDROPS,
  backdropCssGradient,
  formatLanguageLabel,
  getCardPalette,
  getSnapshotFramePadding,
  snapshotMarkdownVariables,
} from '@utils/snapshotExport';
import SnapshotCodePreview from './SnapshotCodePreview';
import SnapshotMarkdownBody from './SnapshotMarkdownBody';

export function SnapshotStagePreview({
  prefs,
  onPrefChange,
  dark,
  renderMode,
  title,
  onTitleChange,
  titleEditable = false,
  effectiveCode = '',
  markdownContent = '',
  selectionHtml,
  documentPath = '',
  markdownBodyRef,
  language = 'plaintext',
  startLine = 1,
  codeFontFamily,
  tabSize = 2,
  indentRainbowStyle = 'surface',
  appBackgroundEnabled = false,
  appBackgroundUrl = '',
  appBackgroundTransparency,
  scrollRef,
  maxCardWidth = 960,
  className = '',
}) {
  const { t } = useTranslation();
  const [resizing, setResizing] = useState(false);

  const {
    backdrop,
    padding,
    radius,
    shadow,
    windowStyle,
    showFileName,
    showFileType,
    showLineNumbers,
    showIndentMarkers,
    showIndentRainbow,
    showWatermark,
    useAppBackground,
    cardWidth,
  } = prefs;

  const minCardWidth = Math.min(400, maxCardWidth);
  const effectiveCardWidth = Math.max(minCardWidth, Math.min(cardWidth, maxCardWidth));

  const hasAppBackground = Boolean(appBackgroundEnabled && appBackgroundUrl);
  const activeAppBackground = Boolean(useAppBackground && hasAppBackground);
  const palette = useMemo(
    () => getCardPalette(dark, activeAppBackground),
    [dark, activeAppBackground],
  );

  const codeOptions = useMemo(() => ({
    dark,
    startLine,
    tabSize,
    showLineNumbers,
    showIndentMarkers,
    showIndentRainbow,
    indentRainbowStyle,
    fontSize: 13.5,
    fontFamily: codeFontFamily,
    foreground: palette.text,
    muted: palette.muted,
    ariaLabel: t('snapshot.preview'),
  }), [
    dark, startLine, tabSize, showLineNumbers, showIndentMarkers, showIndentRainbow,
    indentRainbowStyle, codeFontFamily, palette.text, palette.muted, t,
  ]);

  const cardSurfaceStyle = useMemo(() => {
    if (!activeAppBackground) return {};
    const mode = dark ? 'dark' : 'light';
    const transparency = getBackgroundTransparency(appBackgroundTransparency, mode);
    const washColor = dark
      ? `rgba(24, 24, 24, ${transparency / 100})`
      : `rgba(255, 255, 255, ${transparency / 100})`;
    return {
      backgroundColor: dark ? '#181818' : '#ffffff',
      backgroundImage: `linear-gradient(${washColor}, ${washColor}), url(${JSON.stringify(appBackgroundUrl)})`,
      backgroundSize: 'auto, cover',
      backgroundPosition: 'center, center',
      backgroundRepeat: 'no-repeat, no-repeat',
    };
  }, [activeAppBackground, dark, appBackgroundTransparency, appBackgroundUrl]);

  const startCardResize = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const initialWidth = effectiveCardWidth;
    setResizing(true);
    const onMove = (moveEvent) => {
      const delta = (moveEvent.clientX - startX) * 2;
      const next = Math.max(
        minCardWidth,
        Math.min(maxCardWidth, Math.round((initialWidth + delta) / 10) * 10),
      );
      onPrefChange('cardWidth', next);
    };
    const onUp = () => {
      setResizing(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const stagePad = getSnapshotFramePadding(backdrop, padding);
  const stageBackground = stagePad ? backdropCssGradient(backdrop, dark) : 'none';
  const badgeText = renderMode === 'markdown' ? 'Markdown' : formatLanguageLabel(language);

  return (
    <section
      className={`snapshot-modal__stage${className ? ` ${className}` : ''}`}
      aria-label={t('snapshot.preview')}
    >
      <div className="snapshot-modal__canvas-scroll" ref={scrollRef}>
        <div
          className={`snapshot-frame${stagePad === 0 ? ' snapshot-frame--bare' : backdrop === 'transparent' ? ' snapshot-frame--transparent' : ''}`}
          style={{
            padding: `${stagePad}px`,
            '--snapshot-card-radius': `${radius}px`,
            backgroundImage: stageBackground !== 'none' ? stageBackground : undefined,
          }}
        >
          <div
            className={`snapshot-card${dark ? ' snapshot-card--dark' : ' snapshot-card--light'}${shadow && stagePad ? ' snapshot-card--shadow' : ''}`}
            style={{
              width: `${effectiveCardWidth}px`,
              maxWidth: '100%',
              borderRadius: `${radius}px`,
              ...snapshotMarkdownVariables(palette),
            }}
          >
            {activeAppBackground && (
              <div className="snapshot-card__wallpaper" style={cardSurfaceStyle} aria-hidden="true" />
            )}
            {windowStyle !== 'none' && (
              <div className={`snapshot-card__header snapshot-card__header--${windowStyle}`}>
                <div className="snapshot-card__chrome">
                  {windowStyle === 'mac' && (
                    <span className="snapshot-card__dots" aria-hidden="true">
                      <i className="is-red" />
                      <i className="is-yellow" />
                      <i className="is-green" />
                    </span>
                  )}
                  {windowStyle === 'moki' && (
                    <span className="snapshot-card__moki-dot" aria-hidden="true">
                      M
                    </span>
                  )}
                </div>
                {showFileName ? (
                  titleEditable ? (
                    <input
                      className="snapshot-card__title-input"
                      aria-label={t('snapshot.cardTitle')}
                      value={title}
                      placeholder={t('snapshot.titlePlaceholder')}
                      onChange={(event) => onTitleChange?.(event.target.value)}
                    />
                  ) : (
                    <span className="snapshot-card__title-text">{title}</span>
                  )
                ) : (
                  <span className="snapshot-card__title-spacer" aria-hidden="true" />
                )}
                {showFileType && <span className="snapshot-card__lang">{badgeText}</span>}
              </div>
            )}

            <div
              className={`snapshot-card__body${renderMode === 'markdown' ? ' snapshot-card__body--markdown' : ' snapshot-card__body--code'}`}
            >
              {renderMode === 'markdown' ? (
                <SnapshotMarkdownBody
                  content={markdownContent}
                  selectionHtml={selectionHtml}
                  dark={dark}
                  documentPath={documentPath}
                  contentRef={markdownBodyRef}
                />
              ) : (
                <SnapshotCodePreview code={effectiveCode} language={language} options={codeOptions} />
              )}
            </div>

            {showWatermark && (
              <div className="snapshot-card__watermark" aria-hidden="true">
                <span className="snapshot-card__watermark-dot">M</span>
                <span>MokiDown</span>
              </div>
            )}

            <div
              className={`snapshot-card__resize-handle${resizing ? ' is-active' : ''}`}
              role="separator"
              aria-orientation="vertical"
              aria-label={t('snapshot.width')}
              onMouseDown={startCardResize}
            >
              {resizing && (
                <span className="snapshot-card__width-badge">{effectiveCardWidth}px</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function SnapshotControlsPanel({
  prefs,
  onPrefChange,
  dark,
  renderMode,
  showAllCodeToggles = false,
  appBackgroundEnabled = false,
  appBackgroundUrl = '',
  maxCardWidth = 960,
  controlsTop = null,
  footer = null,
  embedded = false,
}) {
  const { t } = useTranslation();
  const {
    backdrop,
    cardTheme,
    padding,
    shadow,
    windowStyle,
    showFileName,
    showFileType,
    showLineNumbers,
    showIndentMarkers,
    trimIndent,
    showIndentRainbow,
    showWatermark,
    useAppBackground,
    cardWidth,
    scale,
  } = prefs;

  const minCardWidth = Math.min(400, maxCardWidth);
  const effectiveCardWidth = Math.max(minCardWidth, Math.min(cardWidth, maxCardWidth));

  const hasAppBackground = Boolean(appBackgroundEnabled && appBackgroundUrl);
  const showCodeControls = showAllCodeToggles || renderMode === 'code';
  const framePadding = getSnapshotFramePadding(backdrop, padding);
  const activeBackdrop = framePadding ? backdrop : 'none';

  const setFramePadding = (value) => {
    if (value > 0 && backdrop === 'none') onPrefChange('backdrop', DEFAULT_SNAPSHOT_PREFS.backdrop);
    onPrefChange('padding', value);
  };

  const selectBackdrop = (id) => {
    if (id === 'none') {
      setFramePadding(0);
      return;
    }
    onPrefChange('backdrop', id);
    if (framePadding === 0) onPrefChange('padding', DEFAULT_SNAPSHOT_PREFS.padding);
  };

  return (
    <aside
      className={`snapshot-modal__controls${embedded ? ' snapshot-modal__controls--embedded' : ''}`}
      aria-label={t('snapshot.settings')}
    >
      <div className="snapshot-modal__controls-scroll">
        {controlsTop}

        <div className="snapshot-control">
          <div className="snapshot-control__label">{t('snapshot.backdropLabel')}</div>
          <div className="snapshot-swatches" role="radiogroup" aria-label={t('snapshot.backdropLabel')}>
            {SNAPSHOT_BACKDROPS.map((item) => {
              const bg = backdropCssGradient(item.id, dark);
              const active = activeBackdrop === item.id;
              return (
                <Tooltip key={item.id} title={t(item.labelKey)}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={t(item.labelKey)}
                    className={`snapshot-swatch snapshot-swatch--${item.id}${active ? ' is-active' : ''}`}
                    style={bg !== 'none' ? { backgroundImage: bg } : undefined}
                    onClick={() => selectBackdrop(item.id)}
                  >
                    {item.id === 'none' && <StopOutlined aria-hidden="true" />}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </div>

        <div className="snapshot-control">
          <div className="snapshot-control__label">{t('snapshot.theme')}</div>
          <Segmented
            block
            className="settings-indent-segmented"
            value={cardTheme}
            onChange={(value) => onPrefChange('cardTheme', value)}
            options={[
              { value: 'auto', label: t('snapshot.themeAuto') },
              { value: 'light', label: t('snapshot.themeLight') },
              { value: 'dark', label: t('snapshot.themeDark') },
            ]}
          />
        </div>

        <div className="snapshot-control">
          <div className="snapshot-control__label">{t('snapshot.frame')}</div>
          <Segmented
            block
            className="settings-indent-segmented"
            value={windowStyle}
            onChange={(value) => onPrefChange('windowStyle', value)}
            options={[
              { value: 'moki', label: 'Moki' },
              { value: 'mac', label: 'macOS' },
              { value: 'minimal', label: t('snapshot.frameMinimal') },
              { value: 'none', label: t('snapshot.frameNone') },
            ]}
          />
        </div>

        <div className="snapshot-control">
          <div className="snapshot-control__row">
            <span className="snapshot-control__label">{t('snapshot.padding')}</span>
            <span className="snapshot-control__value">{framePadding}px</span>
          </div>
          <Slider
            ariaLabelForHandle={t('snapshot.padding')}
            min={0}
            max={80}
            value={framePadding}
            onChange={setFramePadding}
            tooltip={{ open: false }}
          />
        </div>

        <div className="snapshot-control">
          <div className="snapshot-control__row">
            <span className="snapshot-control__label">{t('snapshot.width')}</span>
            <span className="snapshot-control__value">{effectiveCardWidth}px</span>
          </div>
          <Slider
            min={minCardWidth}
            max={maxCardWidth}
            step={10}
            value={effectiveCardWidth}
            onChange={(value) => onPrefChange('cardWidth', value)}
            tooltip={{ open: false }}
          />
        </div>

        <div className="snapshot-control">
          <div className="snapshot-control__label">{t('snapshot.scale')}</div>
          <Segmented
            block
            className="settings-indent-segmented"
            value={scale}
            onChange={(value) => onPrefChange('scale', value)}
            options={[
              { value: 2, label: '2x Retina' },
              { value: 3, label: '3x Ultra' },
            ]}
          />
        </div>

        <div className="snapshot-toggles">
          <label className="snapshot-toggle snapshot-toggle--stacked">
            <span className="snapshot-toggle__text">
              <span>{t('snapshot.appBackground')}</span>
              {!hasAppBackground && (
                <small className="snapshot-toggle__hint">{t('snapshot.appBackgroundEmpty')}</small>
              )}
            </span>
            <Switch
              size="small"
              aria-label={t('snapshot.appBackground')}
              checked={useAppBackground}
              onChange={(value) => onPrefChange('useAppBackground', value)}
            />
          </label>

          <label className="snapshot-toggle">
            <span>{t('snapshot.showFileName')}</span>
            <Switch
              size="small"
              aria-label={t('snapshot.showFileName')}
              checked={showFileName}
              onChange={(value) => onPrefChange('showFileName', value)}
            />
          </label>

          <label className="snapshot-toggle">
            <span>{t('snapshot.showFileType')}</span>
            <Switch
              size="small"
              aria-label={t('snapshot.showFileType')}
              checked={showFileType}
              onChange={(value) => onPrefChange('showFileType', value)}
            />
          </label>

          {showCodeControls && (
            <>
              <label className="snapshot-toggle">
                <span>{t('snapshot.lineNumbers')}</span>
                <Switch
                  size="small"
                  aria-label={t('snapshot.lineNumbers')}
                  checked={showLineNumbers}
                  onChange={(value) => onPrefChange('showLineNumbers', value)}
                />
              </label>
              <label className="snapshot-toggle">
                <span>{t('snapshot.trimIndent')}</span>
                <Switch
                  size="small"
                  aria-label={t('snapshot.trimIndent')}
                  checked={trimIndent}
                  onChange={(value) => onPrefChange('trimIndent', value)}
                />
              </label>
              <label className="snapshot-toggle">
                <span>{t('snapshot.indentRainbow')}</span>
                <Switch
                  size="small"
                  aria-label={t('snapshot.indentRainbow')}
                  checked={showIndentRainbow}
                  onChange={(value) => onPrefChange('showIndentRainbow', value)}
                />
              </label>
              <label className="snapshot-toggle">
                <span>{t('settings.editor.showWhitespace')}</span>
                <Switch
                  size="small"
                  aria-label={t('settings.editor.showWhitespace')}
                  checked={showIndentMarkers}
                  onChange={(value) => onPrefChange('showIndentMarkers', value)}
                />
              </label>
            </>
          )}

          <label className="snapshot-toggle">
            <span>{t('snapshot.shadow')}</span>
            <Switch
              size="small"
              aria-label={t('snapshot.shadow')}
              checked={shadow}
              onChange={(value) => onPrefChange('shadow', value)}
            />
          </label>

          <label className="snapshot-toggle">
            <span>{t('snapshot.watermark')}</span>
            <Switch
              size="small"
              aria-label={t('snapshot.watermark')}
              checked={showWatermark}
              onChange={(value) => onPrefChange('showWatermark', value)}
            />
          </label>
        </div>
      </div>

      {footer}
    </aside>
  );
}

export default function SnapshotStudioView({
  prefs,
  onPrefChange,
  onReset,
  onClose,
  dialogRef,
  dark,
  renderMode,
  title,
  onTitleChange,
  titleEditable = false,
  scopeBadge,
  headerTitle,
  headerSubtitle,
  headerCenter = null,
  controlsTop = null,
  footer = null,
  showAllCodeToggles = false,
  effectiveCode = '',
  markdownContent = '',
  selectionHtml,
  documentPath = '',
  markdownBodyRef,
  language = 'plaintext',
  startLine = 1,
  codeFontFamily,
  tabSize = 2,
  indentRainbowStyle = 'surface',
  appBackgroundEnabled = false,
  appBackgroundUrl = '',
  appBackgroundTransparency,
  stageScrollRef: externalScrollRef,
  maxCardWidth: externalMaxCardWidth,
  className = '',
}) {
  const { t } = useTranslation();
  const internalScrollRef = useRef(null);
  const stageScrollRef = externalScrollRef || internalScrollRef;
  const measuredMaxCardWidth = useStageMaxCardWidth(stageScrollRef, prefs.backdrop, prefs.padding);
  const maxCardWidth = externalMaxCardWidth ?? measuredMaxCardWidth;

  return (
    <div
      className={`snapshot-modal${className ? ` ${className}` : ''}`}
      ref={dialogRef}
      role="dialog"
      aria-label={headerTitle}
    >
      <header className="snapshot-modal__header">
        <div className="snapshot-modal__brand">
          <span className="snapshot-modal__icon" aria-hidden="true">
            <CameraOutlined />
          </span>
          <div className="snapshot-modal__title-wrap">
            <h2>{headerTitle}</h2>
            {scopeBadge && <span className="snapshot-modal__scope">{scopeBadge}</span>}
            {headerSubtitle && <span className="snapshot-modal__subtitle">{headerSubtitle}</span>}
          </div>
        </div>

        {headerCenter}

        <div className="snapshot-modal__header-actions">
          <Tooltip title={t('snapshot.reset')}>
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined />}
              aria-label={t('snapshot.reset')}
              onClick={onReset}
            />
          </Tooltip>
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            aria-label={t('snapshot.close')}
            onClick={onClose}
          />
        </div>
      </header>

      <div className="snapshot-modal__body">
        <SnapshotStagePreview
          prefs={prefs}
          onPrefChange={onPrefChange}
          dark={dark}
          renderMode={renderMode}
          title={title}
          onTitleChange={onTitleChange}
          titleEditable={titleEditable}
          effectiveCode={effectiveCode}
          markdownContent={markdownContent}
          selectionHtml={selectionHtml}
          documentPath={documentPath}
          markdownBodyRef={markdownBodyRef}
          language={language}
          startLine={startLine}
          codeFontFamily={codeFontFamily}
          tabSize={tabSize}
          indentRainbowStyle={indentRainbowStyle}
          appBackgroundEnabled={appBackgroundEnabled}
          appBackgroundUrl={appBackgroundUrl}
          appBackgroundTransparency={appBackgroundTransparency}
          scrollRef={stageScrollRef}
          maxCardWidth={maxCardWidth}
        />

        <SnapshotControlsPanel
          prefs={prefs}
          onPrefChange={onPrefChange}
          dark={dark}
          renderMode={renderMode}
          showAllCodeToggles={showAllCodeToggles}
          appBackgroundEnabled={appBackgroundEnabled}
          appBackgroundUrl={appBackgroundUrl}
          maxCardWidth={maxCardWidth}
          controlsTop={controlsTop}
          footer={footer}
        />
      </div>
    </div>
  );
}
