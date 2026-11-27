import { useMemo, useRef, useState } from 'react';
import { Button, Segmented, Tooltip } from 'antd';
import { CodeOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import DownloadIcon from '@components/ui/DownloadIcon';
import ImageCopyIcon from '@components/ui/ImageCopyIcon';
import useSnapshotStore from '@store/useSnapshotStore';
import useThemeStore from '@store/useThemeStore';
import useConfigStore from '@store/useConfigStore';
import { useBackgroundImage } from '@hooks/useBackgroundImage';
import { trimCommonIndent } from '@utils/snapshotCapture';
import { useStageMaxCardWidth } from '@hooks/useStageMaxCardWidth';
import { SnapshotControlsPanel, SnapshotStagePreview } from './SnapshotStudioView';
import './snapshot-modal.scss';

function getSampleCode(tabSize) {
  return [
    '\texport function greet(name) {',
    '\t\tif (!name) {',
    `\t\t${' '.repeat(tabSize)}return "Hello, Moki!";`,
    '\t\t}',
    '\t\treturn `Hello, ${name}!`;',
    '\t}',
  ].join('\n');
}

export default function QuickSnapshotSettings({ SettingGroup, SettingRow }) {
  const { t } = useTranslation();
  const quick = useSnapshotStore((s) => s.quick);
  const setQuickPref = useSnapshotStore((s) => s.setQuickPref);
  const resetQuickPrefs = useSnapshotStore((s) => s.resetQuickPrefs);

  const appTheme = useThemeStore((s) => s.theme);
  const fontFamilyBase = useConfigStore((s) => s.fontFamily);
  const tabSize = useConfigStore((s) => s.tabSize) || 2;
  const indentRainbowStyle = useConfigStore((s) => s.indentRainbowStyle) || 'surface';
  const backgroundEnabled = useConfigStore((s) => s.backgroundEnabled);
  const backgroundTransparency = useConfigStore((s) => s.backgroundTransparency);
  const { url: backgroundUrl } = useBackgroundImage();

  const [sampleMode, setSampleMode] = useState('code');
  const markdownBodyRef = useRef(null);
  const stageScrollRef = useRef(null);
  const maxCardWidth = useStageMaxCardWidth(stageScrollRef, quick.backdrop, quick.padding);

  const dark = quick.cardTheme === 'auto' ? appTheme === 'dark' : quick.cardTheme === 'dark';
  const effectiveCode = useMemo(() => {
    const sample = getSampleCode(tabSize);
    return quick.trimIndent ? trimCommonIndent(sample, tabSize) : sample;
  }, [quick.trimIndent, tabSize]);
  const codeFontFamily = `'${fontFamilyBase || 'JetBrains Mono'}', 'Source-HanSan', Consolas, monospace`;

  const markdownSample = t('snapshot.sampleMarkdown');

  return (
    <div className="settings-section snapshot-quick-settings">
      <SettingGroup label={t('settings.quickSnapshot.title')} />

      <SettingRow
        label={t('settings.quickSnapshot.action')}
        desc={t('settings.quickSnapshot.subtitle')}
      >
        <div className="snapshot-quick-settings__top-actions">
          <Segmented
            className="settings-indent-segmented"
            value={quick.quickAction || 'copy'}
            onChange={(value) => setQuickPref('quickAction', value)}
            options={[
              {
                value: 'copy',
                label: (
                  <span className="snapshot-modal__mode-opt">
                    <ImageCopyIcon /> {t('snapshot.copyImage')}
                  </span>
                ),
              },
              {
                value: 'save',
                label: (
                  <span className="snapshot-modal__mode-opt">
                    <DownloadIcon /> {t('snapshot.saveImage')}
                  </span>
                ),
              },
            ]}
          />
          <Tooltip title={t('snapshot.reset')}>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              aria-label={t('snapshot.reset')}
              onClick={resetQuickPrefs}
            />
          </Tooltip>
        </div>
      </SettingRow>

      <div className="snapshot-quick-settings__layout">
        <div className="snapshot-quick-settings__preview-col">
          <div className="snapshot-quick-settings__preview-bar">
            <span className="snapshot-quick-settings__preview-label">{t('snapshot.preview')}</span>
            <Segmented
              className="settings-indent-segmented snapshot-modal__mode-switch"
              value={sampleMode}
              onChange={setSampleMode}
              options={[
                {
                  value: 'code',
                  label: (
                    <span className="snapshot-modal__mode-opt">
                      <CodeOutlined /> {t('snapshot.modeCode')}
                    </span>
                  ),
                },
                {
                  value: 'markdown',
                  label: (
                    <span className="snapshot-modal__mode-opt">
                      <EyeOutlined /> {t('snapshot.modeMarkdown')}
                    </span>
                  ),
                },
              ]}
            />
          </div>

          <SnapshotStagePreview
            className="snapshot-quick-settings__stage"
            prefs={quick}
            onPrefChange={setQuickPref}
            dark={dark}
            renderMode={sampleMode}
            title={sampleMode === 'markdown' ? 'notes.md' : 'greet.js'}
            effectiveCode={effectiveCode}
            markdownContent={markdownSample}
            documentPath=""
            markdownBodyRef={markdownBodyRef}
            language={sampleMode === 'markdown' ? 'markdown' : 'javascript'}
            startLine={1}
            codeFontFamily={codeFontFamily}
            tabSize={tabSize}
            indentRainbowStyle={indentRainbowStyle}
            appBackgroundEnabled={backgroundEnabled}
            appBackgroundUrl={backgroundUrl}
            appBackgroundTransparency={backgroundTransparency}
            scrollRef={stageScrollRef}
            maxCardWidth={maxCardWidth}
          />
        </div>

        <div className="snapshot-quick-settings__controls-col">
          <SnapshotControlsPanel
            prefs={quick}
            onPrefChange={setQuickPref}
            dark={dark}
            renderMode={sampleMode}
            showAllCodeToggles
            appBackgroundEnabled={backgroundEnabled}
            appBackgroundUrl={backgroundUrl}
            maxCardWidth={maxCardWidth}
            embedded
          />
        </div>
      </div>
    </div>
  );
}
