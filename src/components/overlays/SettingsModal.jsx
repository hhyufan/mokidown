import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  createContext,
  useContext,
} from 'react';
import {
  Switch,
  Segmented,
  Select,
  Input,
  InputNumber,
  Button,
  Checkbox,
  Space,
  Tooltip,
} from 'antd';
import { useResponsiveLayout } from '@hooks/useResponsiveLayout';
import {
  SettingOutlined,
  CloseOutlined,
  DownloadOutlined,
  PlusOutlined,
  MinusOutlined,
  InfoCircleOutlined,
  GithubOutlined,
  StarFilled,
  AppstoreOutlined,
  ThunderboltOutlined,
  FolderOpenOutlined,
  CodeOutlined,
  SkinOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import AppMark from '@components/ui/AppMark';
import SearchHighlight from '@components/ui/SearchHighlight';
import { REPO_URL, INSTALLER_URL } from '@/configs/repository';
import { resolveInstallerUrl } from '@utils/installerDownload';
import { open } from '@tauri-apps/plugin-dialog';
import { getVersion } from '@tauri-apps/api/app';
import { openExternal } from '@utils/tauriApi';
import { openEditorLink } from '@utils/editorLinks';
import { useTranslation } from 'react-i18next';
import { markdownPairOptions, normalizeMarkdownPairs } from '@utils/markdownPairs';
import { canCheckUpdates } from '@utils/appUpdater';
import { isWebDemo } from '@utils/webDemo';
import { isAndroidRuntime } from '@utils/platform';
import useUpdateStore from '@store/useUpdateStore';
import useConfigStore from '@store/useConfigStore';
import useEditorStore from '@store/useEditorStore';
import { useFileManager } from '@hooks/useFileManager';
import { loadSettingsDocument } from '@/services/settingsDocuments';
import { settingsDocumentKind } from '@/services/settingsDocumentPaths';

import useNotificationStore from '@store/useNotificationStore';

import './settings-modal.scss';
import LanguageServices from './LanguageServices';
import BackgroundSettings from './BackgroundSettings';
import MokiSettings from '@components/moki/MokiSettings';
import ShortcutsSettings from './ShortcutsSettings';
import MokiSprite from '@components/moki/MokiSprite';
import SettingsNavigation from './SettingsNavigation';

function PaletteIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3a9 9 0 1 0 0 18h1.2a2.3 2.3 0 0 0 0-4.6h-.7a2.2 2.2 0 0 1 0-4.4h3.3A5.2 5.2 0 0 0 21 6.8 3.8 3.8 0 0 0 17.2 3H12Z" />
      <circle cx="7.5" cy="10.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="9.4" cy="6.9" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="13.6" cy="5.8" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

const SettingsSearchContext = createContext('');

const NAV_ICONS = {
  general: <SettingOutlined />,
  appearance: <SkinOutlined />,
  editor: <CodeOutlined />,
  renderer: <PaletteIcon />,
  shortcuts: <ThunderboltOutlined />,
  languages: <AppstoreOutlined />,

  about: <InfoCircleOutlined />,
};

const NAV_KEYS = ['general', 'appearance', 'editor', 'renderer', 'shortcuts', 'languages', 'about'];

const SEARCH_SECTIONS = [
  ['settings.general.', 'general'],
  ['settings.snapshot.', 'general'],
  ['moki.', 'appearance'],
  ['settings.background.', 'appearance'],
  ['settings.appearance.', 'renderer'],
  ['settings.editor.', 'editor'],
  ['settings.documents.', 'languages'],
  ['settings.about.', 'about'],
];

function sectionForSettingKey(key) {
  if (key.startsWith('settings.editor.markdown')) return 'renderer';
  if (key === 'settings.general.externalFileDrag') return 'general';
  if (key === 'web.openLinksInEditor') return 'renderer';
  if (
    key === 'htmlPreview.liveReload' ||
    key === 'htmlPreview.port' ||
    key === 'htmlPreview.title'
  ) {
    return 'renderer';
  }
  if (key === 'languageServices.search') return 'languages';
  if (
    key === 'workspaceDiff.gitSettings' ||
    key === 'workspaceDiff.gitPath' ||
    key === 'workspaceDiff.markdownOnlySetting'
  ) {
    return 'general';
  }
  for (const [prefix, section] of SEARCH_SECTIONS) {
    if (key.startsWith(prefix)) return section;
  }
  return null;
}

function SettingsPage({ side = false }) {
  const { t, i18n } = useTranslation();
  const [activeNav, setActiveNav] = useState('general');
  const [direction, setDirection] = useState('right');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const contentRef = useRef(null);
  const closeSearch = () => {
    setSearching(false);
    setQuery('');
    setMatchIndex(0);
  };
  const activateNav = useCallback(
    (key) => {
      if (key !== activeNav) {
        const index = NAV_KEYS.indexOf(key);
        setDirection(
          index !== 0 && (index === NAV_KEYS.length - 1 || index < NAV_KEYS.indexOf(activeNav))
            ? 'left'
            : 'right',
        );
        setActiveNav(key);
      }
    },
    [activeNav],
  );
  const switchNav = (key) => {
    closeSearch();
    if (contentRef.current) contentRef.current.scrollTop = 0;
    activateNav(key);
  };
  const { openFileFromPath } = useFileManager();

  const [appVersion, setAppVersion] = useState('');
  const [installerUrl, setInstallerUrl] = useState(INSTALLER_URL);
  const pickSettingsDirectory = async () => {
    try {
      const selected = await open({
        title: t('settings.documents.chooseDirectory'),
        directory: true,
        multiple: false,
      });
      if (typeof selected === 'string' && selected) {
        handleChange('settingsDocumentDirectory', selected);
      }
    } catch (error) {
      console.warn('[settings] Failed to pick settings directory:', error);
    }
  };
  const pickImageFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === 'string' && selected) {
        setImageDirDraft(selected);
        handleChange('imageDefaultDir', selected);
      }
    } catch (error) {
      console.warn('[settings] Failed to pick image folder:', error);
    }
  };
  // The browser demo has no native shell. Resolve the newest installer link
  // (Aliyun manifest first, GitHub manifest as fallback) before the click so
  // the anchor can open the direct download without a popup blocker.
  useEffect(() => {
    if (!isWebDemo()) return undefined;
    let cancelled = false;
    resolveInstallerUrl()
      .then((url) => {
        if (!cancelled) setInstallerUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const config = useConfigStore();
  const [imageDirDraft, setImageDirDraft] = useState(() => config.imageDefaultDir || '');
  useEffect(() => {
    setImageDirDraft(config.imageDefaultDir || '');
  }, [config.imageDefaultDir]);
  const updateStage = useUpdateStore((s) => s.stage);

  const notify = useNotificationStore((s) => s.notify);
  const { isMobileLayout, isPortrait } = useResponsiveLayout();
  const compact = side || (isMobileLayout && isPortrait);

  // 从 Tauri 运行时读取应用版本号，避免在前端硬编码版本字符串。
  useEffect(() => {
    let alive = true;
    getVersion()
      .then((v) => {
        if (alive) setAppVersion(v);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /**
   * 在系统默认浏览器中打开项目仓库地址。
   *
   * @returns {Promise<void>} 打开失败时通过通知提示用户。
   */
  async function handleOpenRepo() {
    try {
      await openEditorLink(REPO_URL);
    } catch (err) {
      notify('error', t('notification.error'), err?.message || String(err));
    }
  }

  /**
   * 写入设置项，并在语言切换时同步更新国际化实例。
   *
   * @param {string} key 配置键名。
   * @param {unknown} value 目标配置值。
   */
  async function openSettingsFile(kind) {
    try {
      const { path, name } = await loadSettingsDocument(kind);
      if (!path) return;
      await openFileFromPath(path, name);
    } catch (error) {
      const message = error?.message || String(error);
      notify('error', t('settings.title'), t(message, { defaultValue: message }));
    }
  }

  /** 图床地址或本地端口时才显示图床规则入口。 */
  function isImageHostEndpoint(value) {
    const text = String(value || '').trim();
    return /^https?:\/\//i.test(text) || /:[0-9]+(?:\/|$)/.test(text);
  }

  function handleChange(key, value) {
    config.setConfig(key, value);
    if (key === 'language') {
      i18n.changeLanguage(value === 'zh' ? 'zh' : 'en');
    }
    if (key === 'settingsDocumentDirectory') {
      // 目录变了，旧的配置文件标签不再指向当前目录，关闭后按新目录重新打开。
      const tabs = useEditorStore.getState().tabs.filter((tab) => settingsDocumentKind(tab.path));
      if (tabs.length) useEditorStore.getState().closeTabs(tabs.map((tab) => tab.id));
    }
  }

  /**
   * 导出当前设置快照为本地 JSON 文件。
   *
   * @returns {Promise<void>} 导出结束后重置忙碌状态。
   */
  const darkTheme = document.documentElement.dataset.theme === 'dark';
  const navSummary = {
    appearance: darkTheme ? t('moki.theme.dark') : t('moki.theme.light'),
    editor: `${config.fontSize}px · ${config.lineHeight}px`,
    renderer: `${t('settings.appearance.previewFontSize')} ${config.previewFontSize}`,
  };
  const menuItems = NAV_KEYS.map((key) => ({
    key,
    icon: NAV_ICONS[key],
    label: t(`settings.nav.${key}`),
    tooltip: navSummary[key]
      ? `${t(`settings.nav.${key}`)} · ${navSummary[key]}`
      : t(`settings.nav.${key}`),
  }));
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const keywords = normalizedQuery.split(/\s+/).filter(Boolean);
  const translation =
    i18n.getResourceBundle(i18n.resolvedLanguage || i18n.language, 'translation') || {};
  const native = Boolean(window.__TAURI_INTERNALS__) && !isAndroidRuntime();
  const windows = Boolean(window.__TAURI_INTERNALS__ && /Windows/i.test(navigator.userAgent));
  const results =
    searching && keywords.length
      ? menuItems
          .flatMap(({ key: section, label: sectionLabel }) => {
            const rows = Object.keys(translation)
              .filter((key) => !/(Desc|Hint|Placeholder)$/.test(key))
              .filter((key) => sectionForSettingKey(key) === section)
              .filter(
                (key) =>
                  (native || !key.startsWith('workspaceDiff.')) &&
                  (windows || key !== 'settings.general.externalFileDrag'),
              );
            return rows.flatMap((key) => {
              const label = t(key);
              const title = label.toLocaleLowerCase();
              const description = translation[`${key}Desc`] ?? translation[`${key}Hint`] ?? '';
              const searchable =
                `${label} ${description} ${sectionLabel} ${key}`.toLocaleLowerCase();
              if (!keywords.every((word) => searchable.includes(word))) return [];
              const rank =
                title === normalizedQuery
                  ? 0
                  : title.startsWith(normalizedQuery)
                    ? 1
                    : keywords.every((word) => title.includes(word))
                      ? 2
                      : 3;
              return [{ section, key, label, rank }];
            });
          })
          .sort((left, right) => left.rank - right.rank)
      : [];
  const match = results[Math.min(matchIndex, results.length - 1)];
  const matchSection = match?.section;
  const matchLabel = match?.label;
  const matchKey = match?.key;

  useLayoutEffect(() => {
    if (matchSection) activateNav(matchSection);
  }, [activateNav, matchSection]);

  useEffect(() => {
    if (!matchKey || activeNav !== matchSection) return undefined;
    const pane = contentRef.current?.querySelector('.settings-modal__pane');
    const item = [
      ...(pane?.querySelectorAll(
        '.setting-row__label, [aria-label], .moki-theme-card__meta strong, dt',
      ) || []),
    ].find(
      (element) =>
        (element.getAttribute('aria-label') || element.textContent.trim()) === matchLabel,
    );
    const target =
      item?.closest('.setting-row__label') ||
      item?.closest('.moki-theme-card__meta strong') ||
      item;
    if (!target) return undefined;
    target.setAttribute('data-settings-highlight', '');
    target.scrollIntoView?.({ block: 'center', behavior: 'instant' });
    return () => target.removeAttribute('data-settings-highlight');
  }, [activeNav, matchKey, matchLabel, matchSection]);

  const moveMatch = (step) => {
    if (results.length) setMatchIndex((index) => (index + step + results.length) % results.length);
  };
  const handleSearchKeys = (event) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || !results.length) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      moveMatch(event.shiftKey ? -1 : 1);
    }
    if (
      ['ArrowUp', 'ArrowDown'].includes(event.key) &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      moveMatch(event.key === 'ArrowUp' ? -1 : 1);
    }
  };

  return (
    <SettingsSearchContext.Provider value={searching ? query : ''}>
      <section
        className={`settings-modal settings-page${compact ? ' settings-page--compact' : ''}`}
        aria-label={t('settings.title')}
      >
        <div className="settings-modal__header">
          <SettingsNavigation
            items={menuItems}
            active={activeNav}
            direction={direction}
            onSelect={switchNav}
            searching={searching}
            onSearch={() => setSearching(true)}
            onCloseSearch={closeSearch}
            query={query}
            onQuery={(value) => {
              setQuery(value);
              setMatchIndex(0);
            }}
            onSearchKeys={handleSearchKeys}
            matchIndex={match ? Math.min(matchIndex, results.length - 1) : -1}
            matchCount={results.length}
            onMoveMatch={moveMatch}
            results={results}
            onSelectResult={(index) => setMatchIndex(index)}
          />
          {side && (
            <div className="settings-page__header-actions">
              <Tooltip title={t('settings.closeSide')}>
                <Button
                  size="small"
                  type="text"
                  icon={<CloseOutlined />}
                  aria-label={t('settings.closeSide')}
                  onClick={() => useEditorStore.getState().closeSettingsSplit()}
                />
              </Tooltip>
            </div>
          )}
        </div>

        <div className="settings-modal__body">
          <div className="settings-modal__content" ref={contentRef}>
            <div className="settings-modal__pane" key={activeNav}>
              {activeNav === 'general' && (
                <div className="settings-section">
                  <SettingGroup label={t('settings.group.snapshot')} />
                  <SettingRow
                    label={t('settings.snapshot.title')}
                    desc={t('settings.snapshot.openLocalDesc')}
                  >
                    <Button
                      icon={<SettingOutlined />}
                      onClick={() => void openSettingsFile('localSettings')}
                    >
                      {t('settings.snapshot.openLocal')}
                    </Button>
                  </SettingRow>
                  <SettingRow
                    label={t('settings.documents.directory')}
                    desc={t('settings.documents.directoryDesc')}
                  >
                    <Input
                      key={config.settingsDocumentDirectory}
                      style={{ width: '100%' }}
                      defaultValue={config.settingsDocumentDirectory}
                      placeholder={t('settings.documents.directoryPlaceholder')}
                      onPressEnter={(event) => event.currentTarget.blur()}
                      onBlur={(event) => {
                        const value = event.currentTarget.value.trim();
                        if (value !== config.settingsDocumentDirectory)
                          handleChange('settingsDocumentDirectory', value);
                      }}
                      suffix={
                        <Tooltip title={t('settings.editor.chooseFolder')} placement="top">
                          <Button
                            type="text"
                            size="small"
                            icon={<FolderOpenOutlined />}
                            aria-label={t('settings.editor.chooseFolder')}
                            onClick={() => void pickSettingsDirectory()}
                          />
                        </Tooltip>
                      }
                    />
                  </SettingRow>
                  <SettingGroup label={t('settings.group.workspace')} />
                  <SettingRow
                    label={t('settings.general.language')}
                    desc={t('settings.general.languageDesc')}
                  >
                    <Select
                      style={{ width: 160 }}
                      value={config.language}
                      onChange={(v) => handleChange('language', v)}
                      options={[
                        { value: 'en', label: <span>English</span> },
                        { value: 'zh', label: <span>{t('settings.general.languageZh')}</span> },
                      ]}
                    />
                  </SettingRow>
                  <SettingRow
                    label={t('settings.general.workspacePath')}
                    desc={t('settings.general.workspacePathDesc')}
                  >
                    <Input
                      style={{ width: 260 }}
                      value={config.workspacePath}
                      onChange={(e) => handleChange('workspacePath', e.target.value)}
                      placeholder="/path/to/workspace"
                    />
                  </SettingRow>

                  {window.__TAURI_INTERNALS__ && !isAndroidRuntime() && (
                    <>
                      <SettingGroup label={t('workspaceDiff.gitSettings')} />
                      <SettingRow
                        label={t('workspaceDiff.gitPath')}
                        desc={t('workspaceDiff.autoDetect')}
                      >
                        <Input
                          key={config.gitExecutablePath}
                          aria-label={t('workspaceDiff.gitPath')}
                          defaultValue={config.gitExecutablePath}
                          placeholder={t('workspaceDiff.autoDetect')}
                          onPressEnter={(event) => event.currentTarget.blur()}
                          onBlur={(event) => {
                            const value = event.currentTarget.value.trim();
                            if (value !== config.gitExecutablePath)
                              handleChange('gitExecutablePath', value);
                          }}
                        />
                      </SettingRow>
                      <SettingRow
                        label={t('workspaceDiff.markdownOnlySetting')}
                        desc={t('workspaceDiff.markdownOnlySettingDesc')}
                      >
                        <Switch
                          checked={config.gitChangesMarkdownOnly}
                          onChange={(value) => handleChange('gitChangesMarkdownOnly', value)}
                        />
                      </SettingRow>
                    </>
                  )}
                  <SettingGroup label={t('settings.group.behavior')} />
                  <SettingRow
                    label={t('settings.general.associatedOpenMode')}
                    desc={t('settings.general.associatedOpenModeDesc')}
                  >
                    <Select
                      aria-label={t('settings.general.associatedOpenMode')}
                      style={{ width: 200 }}
                      value={config.associatedOpenMode}
                      onChange={(value) => handleChange('associatedOpenMode', value)}
                      options={[
                        { value: 'editor', label: t('settings.general.openInEditor') },
                        { value: 'reader', label: t('settings.general.openInReader') },
                      ]}
                    />
                  </SettingRow>
                  {windows && (
                    <SettingRow
                      label={t('settings.general.externalFileDrag')}
                      desc={t('settings.general.externalFileDragDesc')}
                    >
                      <Select
                        aria-label={t('settings.general.externalFileDrag')}
                        style={{ width: 200 }}
                        value={config.externalFileDrag}
                        onChange={(value) => handleChange('externalFileDrag', value)}
                        options={[
                          { value: 'reader', label: t('settings.general.openDragWindow') },
                          { value: 'explorer', label: t('settings.general.dragToExplorer') },
                        ]}
                      />
                    </SettingRow>
                  )}
                  <SettingRow
                    label={t('settings.general.startup')}
                    desc={t('settings.general.startupDesc')}
                  >
                    <Switch
                      checked={config.autoSave}
                      onChange={(v) => handleChange('autoSave', v)}
                    />
                  </SettingRow>
                </div>
              )}

              {activeNav === 'appearance' && (
                <div className="settings-section">
                  <MokiSettings SettingGroup={SettingGroup} SettingRow={SettingRow} />
                  <BackgroundSettings SettingGroup={SettingGroup} SettingRow={SettingRow} />
                  {/* 主题切换统一由上面的 Moki 卡片区承担；这里曾有一份 Light/Dark 单选，
                    两处改的是同一个 store，属于重复入口，已移除。 */}
                </div>
              )}

              {activeNav === 'editor' && (
                <div className="settings-section">
                  <SettingGroup label={t('settings.group.font')} />
                  <SettingRow
                    label={t('settings.editor.fontSize')}
                    desc={t('settings.editor.fontSizeDesc')}
                  >
                    <FontSizeControl
                      label={t('settings.editor.fontSize')}
                      value={config.fontSize}
                      onChange={(v) => handleChange('fontSize', Number(v) || 14)}
                    />
                  </SettingRow>
                  <SettingRow
                    label={t('settings.editor.fontFamily')}
                    desc={t('settings.editor.fontFamilyDesc')}
                  >
                    <Select
                      style={{ width: 200 }}
                      value={config.fontFamily}
                      onChange={(v) => handleChange('fontFamily', v)}
                      options={[
                        { value: 'JetBrains Mono', label: <span>JetBrains Mono</span> },
                        { value: 'Fira Code', label: <span>Fira Code</span> },
                        { value: 'Cascadia Code', label: <span>Cascadia Code</span> },
                        { value: 'Consolas', label: <span>Consolas</span> },
                        { value: 'monospace', label: <span>Monospace</span> },
                      ]}
                    />
                  </SettingRow>
                  <SettingGroup label={t('settings.group.formatting')} />
                  <SettingRow
                    label={t('settings.editor.wordWrap')}
                    desc={t('settings.editor.wordWrapDesc')}
                  >
                    <Switch
                      checked={config.wordWrap}
                      onChange={(v) => handleChange('wordWrap', v)}
                    />
                  </SettingRow>
                  <SettingRow
                    label={t('settings.editor.tabBehavior')}
                    desc={t('settings.editor.tabBehaviorDesc')}
                  >
                    <Space size={8}>
                      <Segmented
                        className="settings-indent-segmented"
                        value={config.insertSpaces === false ? 'tab' : 'spaces'}
                        onChange={(v) => handleChange('insertSpaces', v === 'spaces')}
                        options={[
                          { value: 'spaces', label: t('settings.editor.indentUseSpaces') },
                          { value: 'tab', label: t('settings.editor.indentUseTabs') },
                        ]}
                      />
                      <Select
                        style={{ width: 90 }}
                        value={config.tabSize}
                        onChange={(v) => handleChange('tabSize', Number(v))}
                        options={[
                          { value: 2, label: '2' },
                          { value: 4, label: '4' },
                          { value: 8, label: '8' },
                        ]}
                      />
                    </Space>
                  </SettingRow>
                  <SettingGroup label={t('settings.group.indent')} />
                  <SettingRow
                    label={t('settings.editor.showWhitespace')}
                    desc={t('settings.editor.showWhitespaceDesc')}
                  >
                    <Switch
                      checked={config.renderWhitespaceEnabled !== false}
                      onChange={(v) => handleChange('renderWhitespaceEnabled', v)}
                    />
                  </SettingRow>
                  <SettingRow
                    label={t('settings.editor.indentRainbowEnabled')}
                    desc={t('settings.editor.indentRainbowEnabledDesc')}
                  >
                    <Switch
                      checked={config.indentRainbowEnabled !== false}
                      onChange={(v) => handleChange('indentRainbowEnabled', v)}
                    />
                  </SettingRow>
                  <SettingRow
                    label={t('settings.editor.indentRainbowStyle')}
                    desc={t('settings.editor.indentRainbowStyleDesc')}
                  >
                    <Select
                      style={{ width: 140 }}
                      value={config.indentRainbowStyle || 'surface'}
                      onChange={(v) => handleChange('indentRainbowStyle', v)}
                      disabled={config.indentRainbowEnabled === false}
                      options={[
                        {
                          value: 'surface',
                          label: t('settings.editor.indentRainbowSurface'),
                        },
                        { value: 'line', label: t('settings.editor.indentRainbowLine') },
                      ]}
                    />
                  </SettingRow>
                  <SettingGroup label={t('settings.group.display')} />
                  <SettingRow
                    label={t('settings.editor.lineNumbers')}
                    desc={t('settings.editor.lineNumbersDesc')}
                  >
                    <Switch
                      checked={config.lineNumbers}
                      onChange={(v) => handleChange('lineNumbers', v)}
                    />
                  </SettingRow>
                  <SettingRow
                    label={t('settings.editor.minimap')}
                    desc={t('settings.editor.minimapDesc')}
                  >
                    <Switch
                      checked={config.minimap?.enabled ?? false}
                      onChange={(v) => handleChange('minimap', { enabled: v })}
                    />
                  </SettingRow>
                  <SettingGroup label={t('settings.group.file')} />
                  <SettingRow
                    label={t('settings.editor.autoSave')}
                    desc={t('settings.editor.autoSaveDesc')}
                  >
                    <Switch
                      checked={config.autoSave}
                      onChange={(v) => handleChange('autoSave', v)}
                    />
                  </SettingRow>
                  <SettingGroup label={t('settings.group.images')} />
                  <SettingRow
                    label={t('settings.editor.imageDefaultDir')}
                    desc={t('settings.editor.imageDefaultDirDesc')}
                  >
                    <Input
                      key={config.imageDefaultDir}
                      style={{ width: '100%' }}
                      value={imageDirDraft}
                      placeholder={t('settings.editor.imageDefaultDirPlaceholder')}
                      onChange={(event) => setImageDirDraft(event.target.value)}
                      onPressEnter={(event) => event.currentTarget.blur()}
                      onBlur={(event) => {
                        const value = event.currentTarget.value.trim();
                        if (value !== config.imageDefaultDir)
                          handleChange('imageDefaultDir', value);
                      }}
                      suffix={
                        isImageHostEndpoint(imageDirDraft) ? (
                          <Tooltip title={t('settings.editor.imageHostRule')} placement="top">
                            <Button
                              type="text"
                              size="small"
                              icon={<GlobalOutlined />}
                              aria-label={t('settings.editor.imageHostRule')}
                              onClick={() => void openSettingsFile('imageHost')}
                            />
                          </Tooltip>
                        ) : (
                          <Tooltip title={t('settings.editor.chooseFolder')} placement="top">
                            <Button
                              type="text"
                              size="small"
                              icon={<FolderOpenOutlined />}
                              aria-label={t('settings.editor.chooseFolder')}
                              onClick={() => void pickImageFolder()}
                            />
                          </Tooltip>
                        )
                      }
                    />
                  </SettingRow>
                </div>
              )}

              {activeNav === 'renderer' && (
                <div className="settings-section">
                  <SettingGroup label={t('htmlPreview.title')} />
                  <SettingRow
                    label={t('web.openLinksInEditor')}
                    desc={t('web.openLinksInEditorHint')}
                  >
                    <Switch
                      checked={config.openLinksInEditor === true}
                      onChange={(value) => handleChange('openLinksInEditor', value)}
                    />
                  </SettingRow>
                  <SettingRow
                    label={t('htmlPreview.liveReload')}
                    desc={t('htmlPreview.liveReloadHint')}
                  >
                    <Switch
                      checked={config.htmlPreviewLiveReload ?? true}
                      onChange={(v) => handleChange('htmlPreviewLiveReload', v)}
                    />
                  </SettingRow>
                  <SettingRow label={t('htmlPreview.port')} desc={t('htmlPreview.portHint')}>
                    <InputNumber
                      aria-label={t('htmlPreview.port')}
                      min={0}
                      max={65535}
                      precision={0}
                      value={config.htmlPreviewPort ?? 0}
                      onChange={(value) => handleChange('htmlPreviewPort', Number(value) || 0)}
                    />
                  </SettingRow>
                  <SettingGroup label={t('settings.group.typography')} />
                  <SettingRow
                    label={t('settings.appearance.previewZoomSync')}
                    desc={t('settings.appearance.previewZoomSyncDesc')}
                  >
                    <Switch
                      checked={config.previewZoomSync ?? true}
                      onChange={(v) => handleChange('previewZoomSync', v)}
                    />
                  </SettingRow>
                  <SettingRow
                    label={t('settings.appearance.previewFontSize')}
                    desc={t('settings.appearance.previewFontSizeDesc')}
                  >
                    <FontSizeControl
                      label={t('settings.appearance.previewFontSize')}
                      disabled={config.previewZoomSync ?? true}
                      value={config.previewFontSize ?? config.fontSize ?? 14}
                      onChange={(v) =>
                        handleChange('previewFontSize', Number(v) || config.fontSize || 14)
                      }
                    />
                  </SettingRow>
                  <SettingGroup label={t('settings.group.taskList')} />
                  <SettingRow
                    label={t('settings.editor.markdownTaskCascade')}
                    desc={t('settings.editor.markdownTaskCascadeDesc')}
                  >
                    <Switch
                      aria-label={t('settings.editor.markdownTaskCascade')}
                      checked={config.markdownTaskCascade !== false}
                      onChange={(value) => handleChange('markdownTaskCascade', value)}
                    />
                  </SettingRow>
                  <SettingGroup label={t('settings.group.folding')} />
                  <SettingRow
                    label={t('settings.editor.markdownFolding')}
                    desc={t('settings.editor.markdownFoldingDesc')}
                  >
                    <Switch
                      aria-label={t('settings.editor.markdownFolding')}
                      checked={config.markdownFolding !== false}
                      onChange={(value) => handleChange('markdownFolding', value)}
                    />
                  </SettingRow>
                  <SettingGroup label={t('settings.group.inputAssist')} />
                  <MarkdownPairSettings
                    enabled={config.markdownSmartPairsEnabled}
                    value={config.markdownSmartPairs}
                    onToggle={(value) => handleChange('markdownSmartPairsEnabled', value)}
                    onChange={(value) => handleChange('markdownSmartPairs', value)}
                  />
                </div>
              )}

              {activeNav === 'shortcuts' && (
                <ShortcutsSettings SettingGroup={SettingGroup} SettingRow={SettingRow} />
              )}

              {activeNav === 'languages' && <LanguageServices onOpenConfig={openSettingsFile} />}

              {activeNav === 'about' && (
                <div className="settings-section">
                  <div
                    className={`settings-about__hero ${config.mokiDisplay === 'hidden' ? 'settings-about__hero--plain' : ''}`}
                  >
                    {/* 两栏共用一条基线网格：左栏是人物画布（贴底 + 底部柔光），
                      右栏是品牌、简介与一条 dl 清单，避免原先七八个元素各自对齐的杂乱。 */}
                    {config.mokiDisplay !== 'hidden' && (
                      <div className="settings-about__portrait">
                        <MokiSprite art="themes" />
                        <div className="settings-about__caption">{t('moki.caption')}</div>
                      </div>
                    )}
                    <div className="settings-about__body">
                      <div className="settings-about__identity">
                        <AppMark size={46} className="settings-about__logo" />
                        <div className="settings-about__identity-text">
                          <div className="settings-about__name">{t('app.name')}</div>
                          {appVersion && (
                            <span className="settings-about__version">v{appVersion}</span>
                          )}
                        </div>
                      </div>
                      <p className="settings-about__tagline">{t('settings.about.tagline')}</p>
                      {(canCheckUpdates() || isWebDemo()) && (
                        <div>
                          <Button
                            icon={<DownloadOutlined />}
                            loading={['checking', 'downloading', 'installing'].includes(
                              updateStage,
                            )}
                            onClick={() => useUpdateStore.getState().check()}
                          >
                            {t('sidebar.footer.checkUpdates')}
                          </Button>
                          {isWebDemo() ? (
                            <Button
                              type="link"
                              href={installerUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {t('settings.about.installer')}
                            </Button>
                          ) : (
                            <Button
                              type="link"
                              onClick={async () => {
                                const url = await resolveInstallerUrl();
                                try {
                                  await openExternal(url);
                                } catch (err) {
                                  notify(
                                    'error',
                                    t('notification.error'),
                                    err?.message || String(err),
                                  );
                                }
                              }}
                            >
                              {t('settings.about.installer')}
                            </Button>
                          )}
                        </div>
                      )}
                      <dl className="settings-about__meta">
                        <dt>{t('settings.about.author')}</dt>
                        <dd>{t('settings.about.authorDesc')}</dd>
                        <dt>{t('settings.about.repository')}</dt>
                        <dd>
                          <button
                            type="button"
                            className="settings-about__link"
                            onClick={handleOpenRepo}
                          >
                            <GithubOutlined />
                            <span>{t('settings.about.repositoryDesc')}</span>
                          </button>
                        </dd>
                      </dl>
                      <div className="settings-about__footer">
                        <StarFilled className="settings-about__star-icon" />
                        <span>{t('settings.about.starHint')}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </SettingsSearchContext.Provider>
  );
}

/**
 * 字号输入与增减按钮，使用 Compact 组合保持控件尺寸一致。
 *
 * @param {object} props 组件属性。
 * @param {string} props.label 字号设置名称。
 */
function FontSizeControl({ label, value, onChange, disabled = false }) {
  const { t } = useTranslation();
  return (
    <Space.Compact className="setting-font-size">
      <Tooltip title={t('settings.fontSize.decrease', { label })}>
        <Button
          disabled={disabled}
          aria-label={t('settings.fontSize.decrease', { label })}
          icon={<MinusOutlined />}
          onClick={() => onChange(Math.max(10, (value || 14) - 1))}
        />
      </Tooltip>
      <InputNumber
        aria-label={label}
        min={10}
        max={24}
        step={1}
        disabled={disabled}
        value={value}
        onChange={onChange}
      />
      <Tooltip title={t('settings.fontSize.increase', { label })}>
        <Button
          disabled={disabled}
          aria-label={t('settings.fontSize.increase', { label })}
          icon={<PlusOutlined />}
          onClick={() => onChange(Math.min(24, (value || 14) + 1))}
        />
      </Tooltip>
    </Space.Compact>
  );
}

/** 设置分组标题。 */
function SettingGroup({ label }) {
  return (
    <div className="settings-group">
      <span className="settings-group__label">{label}</span>
    </div>
  );
}

function MarkdownPairSettings({ enabled, value, onToggle, onChange }) {
  const { t } = useTranslation();
  const selected = normalizeMarkdownPairs(value);
  const label = t('settings.editor.markdownSmartPairs');
  return (
    <>
      <SettingRow label={label} desc={t('settings.editor.markdownSmartPairsDesc')}>
        <Switch aria-label={label} checked={enabled} onChange={onToggle} />
      </SettingRow>
      <ul className="settings-pair-list" aria-label={label}>
        {markdownPairOptions.map(({ value: symbol, name, label: characters }) => {
          const title = t(`settings.editor.pair.${name}`);
          const description = `markdown-pair-${name}`;
          return (
            <li key={symbol}>
              <Checkbox
                aria-label={title}
                aria-describedby={description}
                checked={selected.includes(symbol)}
                disabled={!enabled}
                onChange={({ target }) =>
                  onChange(
                    target.checked
                      ? [...selected, symbol]
                      : selected.filter((item) => item !== symbol),
                  )
                }
              >
                <span className="settings-pair-list__title">
                  {title}
                  <code aria-hidden="true">{characters}</code>
                </span>
                <span className="setting-row__desc" id={description}>
                  {t(`settings.editor.pair.${name}Desc`)}
                </span>
              </Checkbox>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * 单条设置项行布局。
 *
 * @param {object} props 组件属性。
 * @param {React.ReactNode} props.label 设置项名称。
 * @param {React.ReactNode} props.desc 设置项说明文本。
 * @param {React.ReactNode} props.children 设置控件内容。
 */
function SettingRow({ label, desc, children }) {
  const searchQuery = useContext(SettingsSearchContext);
  const highlight = (text) =>
    searchQuery && typeof text === 'string' ? (
      <SearchHighlight text={text} query={searchQuery} />
    ) : (
      text
    );
  return (
    <div className="setting-row">
      <div className="setting-row__info">
        <span className="setting-row__label">{highlight(label)}</span>
        {desc && <span className="setting-row__desc">{highlight(desc)}</span>}
      </div>
      <div className="setting-row__control">{children}</div>
    </div>
  );
}

export default SettingsPage;
