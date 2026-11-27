import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'antd';
import { CheckOutlined, CopyOutlined, DownloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import useSnapshotStore from '@store/useSnapshotStore';
import useThemeStore from '@store/useThemeStore';
import useConfigStore from '@store/useConfigStore';
import useNotificationStore from '@store/useNotificationStore';
import { useBackgroundImage } from '@hooks/useBackgroundImage';
import { useStageMaxCardWidth } from '@hooks/useStageMaxCardWidth';
import { getBackgroundTransparency } from '@utils/backgroundImage';
import { formatSnapshotFileName, trimCommonIndent } from '@utils/snapshotCapture';
import {
  copySnapshotCanvas,
  renderCodeSnapshotCanvas,
  renderMarkdownSnapshotCanvas,
  saveSnapshotCanvas,
  tokenizeSnapshotCode,
} from '@utils/snapshotExport';
import SnapshotStudioView from './SnapshotStudioView';
import './snapshot-modal.scss';

export default function SnapshotModal() {
  const { t } = useTranslation();
  const open = useSnapshotStore((s) => s.open);
  const payload = useSnapshotStore((s) => s.payload);
  const closeSnapshot = useSnapshotStore((s) => s.closeSnapshot);

  const backdrop = useSnapshotStore((s) => s.backdrop);
  const cardTheme = useSnapshotStore((s) => s.cardTheme);
  const padding = useSnapshotStore((s) => s.padding);
  const radius = useSnapshotStore((s) => s.radius);
  const shadow = useSnapshotStore((s) => s.shadow);
  const windowStyle = useSnapshotStore((s) => s.windowStyle);
  const showFileName = useSnapshotStore((s) => s.showFileName);
  const showFileType = useSnapshotStore((s) => s.showFileType);
  const showLineNumbers = useSnapshotStore((s) => s.showLineNumbers);
  const showIndentMarkers = useSnapshotStore((s) => s.showIndentMarkers);
  const trimIndent = useSnapshotStore((s) => s.trimIndent);
  const showIndentRainbow = useSnapshotStore((s) => s.showIndentRainbow);
  const showWatermark = useSnapshotStore((s) => s.showWatermark);
  const useAppBackground = useSnapshotStore((s) => s.useAppBackground);
  const cardWidth = useSnapshotStore((s) => s.cardWidth);
  const scale = useSnapshotStore((s) => s.scale);
  const setPref = useSnapshotStore((s) => s.setPref);
  const resetPrefs = useSnapshotStore((s) => s.resetPrefs);

  const appTheme = useThemeStore((s) => s.theme);
  const fontFamilyBase = useConfigStore((s) => s.fontFamily);
  const tabSize = useConfigStore((s) => s.tabSize) || 2;
  const indentRainbowStyle = useConfigStore((s) => s.indentRainbowStyle) || 'surface';
  const backgroundEnabled = useConfigStore((s) => s.backgroundEnabled);
  const backgroundTransparency = useConfigStore((s) => s.backgroundTransparency);
  const { url: backgroundUrl } = useBackgroundImage();
  const notify = useNotificationStore((s) => s.notify);

  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState(false);

  const markdownBodyRef = useRef(null);
  const copiedTimerRef = useRef(null);
  const stageScrollRef = useRef(null);
  const dialogRef = useRef(null);
  const maxCardWidth = useStageMaxCardWidth(stageScrollRef, backdrop, padding);
  const effectiveCardWidth = Math.max(Math.min(400, maxCardWidth), Math.min(cardWidth, maxCardWidth));

  useEffect(() => {
    if (!open || !payload) return;
    setTitle(payload.fileName || '');
    setCopied(false);
  }, [open, payload]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  const renderMode = payload?.mode === 'markdown' ? 'markdown' : 'code';
  const dark = cardTheme === 'auto' ? appTheme === 'dark' : cardTheme === 'dark';
  const effectiveCode = useMemo(() => {
    const raw = payload?.content || '';
    return renderMode === 'code' && trimIndent ? trimCommonIndent(raw, tabSize) : raw;
  }, [payload?.content, renderMode, trimIndent, tabSize]);

  const codeFontFamily = `'${fontFamilyBase || 'JetBrains Mono'}', 'Source-HanSan', Consolas, monospace`;
  const language = payload?.language || (renderMode === 'markdown' ? 'markdown' : 'plaintext');
  const startLine = payload?.startLine || 1;

  const prefs = useMemo(
    () => ({
      backdrop,
      cardTheme,
      padding,
      radius,
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
    }),
    [
      backdrop,
      cardTheme,
      padding,
      radius,
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
    ],
  );

  const appBackgroundOption = useMemo(() => {
    if (!useAppBackground || !backgroundEnabled || !backgroundUrl) return null;
    const mode = dark ? 'dark' : 'light';
    const transparency = getBackgroundTransparency(backgroundTransparency, mode);
    return {
      imageUrl: backgroundUrl,
      opacity: (100 - transparency) / 100,
      transparency,
    };
  }, [useAppBackground, backgroundEnabled, backgroundUrl, dark, backgroundTransparency]);

  const buildCanvas = useCallback(async () => {
    if (!payload) return null;
    const commonOptions = {
      dark,
      backdrop,
      padding,
      radius,
      shadow,
      windowStyle,
      showFileName,
      showFileType,
      showWatermark,
      appBackground: appBackgroundOption,
      cardWidth: effectiveCardWidth,
      scale,
      title: title.trim(),
      fontFamily: codeFontFamily,
    };
    if (renderMode === 'markdown') {
      const fallbackTokens = await tokenizeSnapshotCode(payload.content, 'markdown', dark);
      return renderMarkdownSnapshotCanvas(markdownBodyRef.current, {
        ...commonOptions,
        fontSize: 14,
        fallbackTokens,
      });
    }
    const readyTokens = await tokenizeSnapshotCode(effectiveCode, language, dark);
    return renderCodeSnapshotCanvas({
      ...commonOptions,
      tokens: readyTokens,
      language,
      startLine,
      showLineNumbers,
      showIndentMarkers,
      showIndentRainbow,
      indentRainbowStyle,
      tabSize,
      fontSize: 13.5,
    });
  }, [
    payload,
    dark,
    backdrop,
    padding,
    radius,
    shadow,
    windowStyle,
    showFileName,
    showFileType,
    showWatermark,
    appBackgroundOption,
    effectiveCardWidth,
    scale,
    title,
    codeFontFamily,
    renderMode,
    effectiveCode,
    language,
    startLine,
    showLineNumbers,
    showIndentMarkers,
    showIndentRainbow,
    indentRainbowStyle,
    tabSize,
  ]);

  const handleCopy = useCallback(async () => {
    if (busy) return;
    setBusy('copy');
    try {
      const canvas = await buildCanvas();
      if (!canvas) return;
      await copySnapshotCanvas(canvas);
      if (dialogRef.current) {
        setCopied(true);
        if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
      }
      notify('success', t('snapshot.copied'), '', 2400);
    } catch (error) {
      notify('error', t('snapshot.copyFailed'), error?.message || '', 3000);
    } finally {
      setBusy('');
    }
  }, [busy, buildCanvas, notify, t]);

  const handleSave = useCallback(async () => {
    if (busy) return;
    setBusy('save');
    try {
      const canvas = await buildCanvas();
      if (!canvas) return;
      const suggestedName = formatSnapshotFileName(title || payload?.fileName);
      const result = await saveSnapshotCanvas(canvas, suggestedName);
      if (result.saved) {
        notify('success', t('snapshot.saved'), suggestedName, 2600);
      }
    } catch (error) {
      notify('error', t('snapshot.saveFailed'), error?.message || '', 3000);
    } finally {
      setBusy('');
    }
  }, [busy, buildCanvas, title, payload?.fileName, notify, t]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!dialogRef.current?.contains(event.target)) closeSnapshot();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, closeSnapshot]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeSnapshot();
        return;
      }
      if (event.target?.closest?.('input, textarea')) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
        const key = event.key.toLowerCase();
        if (key === 'c') {
          event.preventDefault();
          event.stopPropagation();
          void handleCopy();
        } else if (key === 's') {
          event.preventDefault();
          event.stopPropagation();
          void handleSave();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, closeSnapshot, handleCopy, handleSave]);

  if (!open || !payload) return null;

  return (
    <div className="moki-snapshot-modal-root">
      <SnapshotStudioView
        prefs={prefs}
        onPrefChange={setPref}
        onReset={resetPrefs}
        onClose={closeSnapshot}
        dialogRef={dialogRef}
        dark={dark}
        renderMode={renderMode}
        title={title}
        onTitleChange={setTitle}
        titleEditable
        headerTitle={t('snapshot.title')}
        scopeBadge={
          payload.isSelection ? t('snapshot.scopeSelection') : t('snapshot.scopeDocument')
        }
        effectiveCode={effectiveCode}
        markdownContent={payload.content}
        selectionHtml={payload.selectionHtml}
        documentPath={payload.documentPath}
        markdownBodyRef={markdownBodyRef}
        language={language}
        startLine={startLine}
        codeFontFamily={codeFontFamily}
        tabSize={tabSize}
        indentRainbowStyle={indentRainbowStyle}
        appBackgroundEnabled={backgroundEnabled}
        appBackgroundUrl={backgroundUrl}
        appBackgroundTransparency={backgroundTransparency}
        stageScrollRef={stageScrollRef}
        maxCardWidth={maxCardWidth}
        footer={
          <div className="snapshot-modal__footer">
            <Button
              type="primary"
              block
              icon={copied ? <CheckOutlined /> : <CopyOutlined />}
              loading={busy === 'copy'}
              disabled={busy === 'save'}
              onClick={handleCopy}
            >
              {copied ? t('snapshot.copiedButton') : t('snapshot.copyImage')}
            </Button>
            <Button
              block
              icon={<DownloadOutlined />}
              loading={busy === 'save'}
              disabled={busy === 'copy'}
              onClick={handleSave}
            >
              {t('snapshot.saveImage')}
            </Button>
          </div>
        }
      />
    </div>
  );
}
