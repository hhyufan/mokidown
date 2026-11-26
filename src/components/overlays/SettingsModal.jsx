import { flushSync } from 'react-dom';
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
  InfoCircleOutlined,
  GithubOutlined,
  StarFilled,
  FolderOpenOutlined,
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

/** 画盘（渲染器）图标。 */
function PaletteIcon() {
  return (
    <svg
      viewBox="0 0 1024 1024"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="28"
      aria-hidden="true"
    >
      <path d="M512 88.086022c234.121634 0 423.913978 189.792344 423.913978 423.913978l-0.022021 4.073978-0.027527 2.092044-0.088086 4.299698-0.137634 4.437334-0.192688 4.569462-0.236732 4.67957-0.29729 4.800688-0.545032 7.388215-0.44043 5.03742-0.495484 5.12-0.561549 5.197075-0.627613 5.257634-0.335827 2.648086-0.72671 5.340215c-0.253247 1.789247-0.517505 3.578495-0.79828 5.384258l-0.869849 5.417291-0.94142 5.439312-1.018494 5.461333-0.539527 2.730667-1.134108 5.472344a381.027097 381.027097 0 0 1-1.585548 7.052387l-1.139613 4.69058c-0.192688 0.781763-0.385376 1.563527-0.589075 2.339785l-1.227699 4.663054a320.423914 320.423914 0 0 1-2.659097 9.249032l-1.431398 4.569463c-14.143312 43.987957-37.926538 82.107183-76.508215 91.994838-25.187097 6.457806-56.259441 4.23914-89.187097-1.266236l-6.606451-1.139613-6.656-1.222194-6.683527-1.288258-6.716559-1.343311-6.733075-1.398366-6.749592-1.431398-12.414623-2.71415-26.739613-5.929291-11.368603-2.460903-5.632-1.189161-8.368172-1.712172-5.532903-1.084559-5.472344-1.035011-5.422796-0.974452-5.362236-0.908387-5.296172-0.842323-5.230108-0.759741a341.938925 341.938925 0 0 0-10.24-1.277248l-4.993376-0.500989c-27.251613-2.482925-50.588903-0.423914-66.637075 10.68043-11.241978 7.773591-11.286022 20.413935-6.110968 35.372043l0.968946 2.664602 0.523011 1.348817 1.112086 2.730667c0.198194 0.456946 0.390882 0.919398 0.594581 1.376344l1.244215 2.791226 2.020473 4.250151 1.431398 2.873806 1.486451 2.901333 3.138065 5.874237 3.292215 5.945806 10.548301 18.652215 2.405849 4.332732 2.339785 4.305204 1.084559 2.048 2.10856 4.073978c6.848688 13.510194 11.875097 26.321204 11.875096 37.07871l-0.01101 1.690151-0.077076 3.385806a143.888516 143.888516 0 0 1-0.704688 10.146409l-0.396387 3.358279C566.982194 904.004817 548.814452 935.913978 512 935.913978c-234.121634 0-423.913978-189.792344-423.913978-423.913978s189.792344-423.913978 423.913978-423.913978z m0 66.064516c-197.637505 0-357.849462 160.211957-357.849462 357.849462 0 193.67914 153.875269 351.424688 346.034924 357.656774l3.881291 0.093592 0.176172-0.550538c1.084559-3.622538 1.926882-8.313118 2.27372-13.587269l0.110108-2.224172-0.253248-0.693677-0.578064-1.458925-0.737721-1.723183-0.759742-1.67914-1.266236-2.670107-1.475441-2.92886-2.339785-4.442839-2.092043-3.853764-4.283183-7.635957-6.843182-12.067784-2.758194-4.932818-3.782194-6.909247-2.301247-4.32172c-7.746065-14.77643-12.442151-26.001892-15.965591-39.115699-10.262022-38.17428-1.811269-76.965161 33.913118-101.678796 30.086882-20.810323 65.497462-26.007398 108.676129-22.280258 2.240688 0.198194 4.448344 0.401892 6.644989 0.627613l6.485334 0.715699 4.822709 0.605591 4.888774 0.671656 4.993377 0.748731 3.413333 0.550538 5.285161 0.897376 5.521893 0.990968 5.802667 1.09557 6.132989 1.205677 6.501849 1.321291 9.337119 1.959914 7.558881 1.624086 19.775312 4.349247 17.380473 3.853763 9.882151 2.136086 5.681548 1.189162 8.192 1.657118 5.230108 1.018495 5.064946 0.946924 4.89428 0.88086 4.718107 0.814796 4.558452 0.743226 4.39329 0.671656 6.28714 0.886366 3.996903 0.506494 3.842753 0.44043 5.483355 0.534022 3.468387 0.275269 3.330752 0.209204 1.60757 0.077075 3.121549 0.110108 2.978408 0.044043h1.442409l2.780215-0.055054c1.816774-0.055054 3.539957-0.154151 5.175054-0.291785l2.405849-0.247742 2.284731-0.308301c1.849806-0.275269 3.578495-0.627613 5.19157-1.046022 8.368172-2.147097 20.127656-17.413505 30.059355-48.337204C864.520258 587.48972 869.849462 546.683871 869.849462 512c0-197.637505-160.211957-357.849462-357.849462-357.849462zM258.752688 462.451613c30.406194 0 55.053763 24.64757 55.053764 55.053763s-24.64757 55.053763-55.053764 55.053764-55.053763-24.64757-55.053763-55.053764 24.64757-55.053763 55.053763-55.053763z m467.956989-126.623656c30.406194 0 55.053763 24.64757 55.053764 55.053763s-24.64757 55.053763-55.053764 55.053764-55.053763-24.64757-55.053763-55.053764 24.64757-55.053763 55.053763-55.053763zM335.827957 269.763441c30.406194 0 55.053763 24.64757 55.053763 55.053763s-24.64757 55.053763-55.053763 55.053764-55.053763-24.64757-55.053763-55.053764 24.64757-55.053763 55.053763-55.053763z m209.204301-71.569893c30.406194 0 55.053763 24.64757 55.053764 55.053764s-24.64757 55.053763-55.053764 55.053763-55.053763-24.64757-55.053763-55.053763 24.64757-55.053763 55.053763-55.053764z" />
    </svg>
  );
}

/** 源码（编辑器）图标。 */
function CodeIcon() {
  return (
    <svg viewBox="0 0 1024 1024" fill="currentColor" aria-hidden="true">
      <path d="M958.17 447.4L760.69 249.92l-65.82 65.83 197.47 197.47L694.87 710.7l65.82 65.82 197.48-197.47 65.83-65.83zM263.3 249.92L65.82 447.4 0 513.22l65.82 65.83L263.3 776.52l65.82-65.82-197.47-197.48 197.47-197.47zM343.247 949.483L590.96 52.19l89.72 24.768-247.713 897.295z" />
    </svg>
  );
}

/** 外观图标。 */
function AppearanceIcon() {
  return (
    <svg viewBox="0 0 1024 1024" fill="currentColor" aria-hidden="true">
      <path d="M409.6 645.888v-55.04a102.4 102.4 0 0 1 102.4-102.4h281.6a153.6 153.6 0 0 0 153.6-153.6V192H1024v142.848a230.4 230.4 0 0 1-230.4 230.4H512a25.6 25.6 0 0 0-25.6 25.6v55.04A128 128 0 0 1 576 768v128a128 128 0 1 1-256 0v-128a128 128 0 0 1 89.6-122.112zM128 64h640a128 128 0 0 1 128 128v128a128 128 0 0 1-128 128H128a128 128 0 0 1-128-128V192a128 128 0 0 1 128-128z m0 76.8a51.2 51.2 0 0 0-51.2 51.2v128a51.2 51.2 0 0 0 51.2 51.2h640a51.2 51.2 0 0 0 51.2-51.2V192a51.2 51.2 0 0 0-51.2-51.2H128zM499.2 768a51.2 51.2 0 1 0-102.4 0v128a51.2 51.2 0 1 0 102.4 0v-128z" />
    </svg>
  );
}

/** 快捷键图标。 */
function ShortcutsIcon() {
  return (
    <svg viewBox="0 0 1024 1024" fill="currentColor" aria-hidden="true">
      <path d="M143.701 85.59H881.92c78.293 0 141.355 64.938 141.355 143.231v569.6a141.141 141.141 0 0 1-141.355 141.44H678.4c-19.584 0-37.675-19.712-37.675-39.338s18.091-44.374 37.718-44.374h192.426c39.168 0 69.974-30.89 69.974-70.016V245.205c0-39.125-30.806-71.808-69.974-71.808H158.336c-39.168 0-72.277 32.683-72.277 71.808v540.928c0 39.126 33.109 69.974 72.234 69.974H347.18c19.626 0 36.266 17.152 36.266 44.416 0 27.306-16.64 39.338-36.266 39.338h-203.52C65.45 939.861 0 876.715 0 798.421v-569.6C0 150.528 65.408 85.59 143.701 85.59z m709.547 294.613v269.226c0 19.627-14.464 34.006-34.048 34.006H605.44c-19.627 0-32.725-24.022-32.725-43.606 0-19.626 13.141-42.496 32.725-42.496H768v-217.13c0-19.627 23.68-37.76 43.264-37.76 19.627 0 41.984 18.176 41.984 37.76z m-448.427 217.13h72.79c15.872 0 28.117 23.808 28.117 43.392 0 19.627-12.245 43.435-28.117 43.435h-72.79c-15.872 0-29.44-23.808-29.44-43.435 0-19.584 13.568-43.392 29.44-43.392z m-206.677 0h72.79c15.914 0 28.117 23.808 28.117 43.392 0 19.627-12.203 43.435-28.118 43.435h-72.789c-15.872 0-29.44-23.808-29.44-43.435 0-19.584 13.568-43.392 29.44-43.392z m209.195-255.616h72.789c15.915 0 28.757 22.998 28.757 42.582 0 19.626-12.842 42.624-28.757 42.624h-72.79c-15.871 0-28.757-23.04-28.757-42.624 0-19.627 12.886-42.582 28.758-42.582z m262.485 85.163h-69.419c-15.872 0-28.714-22.997-28.714-42.581 0-19.627 12.842-42.624 28.714-42.624h69.462c15.872 0 28.757 23.04 28.757 42.624 0 19.626-12.885 42.581-28.757 42.581z m-471.552-85.12h72.832c15.872 0 28.757 22.997 28.757 42.581 0 19.627-12.885 42.624-28.757 42.624h-72.832c-15.872 0-28.715-23.04-28.715-42.624 0-19.626 12.843-42.581 28.715-42.581z" />
    </svg>
  );
}

/** 插件图标。 */
function PluginsIcon() {
  return (
    <svg viewBox="0 0 1024 1024" fill="currentColor" aria-hidden="true">
      <path d="M576 32A160 160 0 0 1 736 192H896a64 64 0 0 1 64 64v640a64 64 0 0 1-64 64h-234.24v-104.32a87.68 87.68 0 0 0-79.232-87.296L574.08 768a87.68 87.68 0 0 0-87.68 87.68V960H256a64 64 0 0 1-64-64v-160a160 160 0 1 1 0-320V256a64 64 0 0 1 64-64h160A160 160 0 0 1 576 32z m0 74.24c-47.36 0-85.76 38.4-85.76 85.76v74.24h-211.2a12.8 12.8 0 0 0-12.8 12.8v211.2H192a85.76 85.76 0 0 0 0 171.52h74.24v211.2c0 7.04 5.76 12.8 12.8 12.8h133.12v-30.08c0-85.824 66.816-156.096 154.368-161.472l11.072-0.384 11.968 0.64A161.92 161.92 0 0 1 736 855.68v30.08h136.96a12.8 12.8 0 0 0 12.8-12.8V279.04a12.8 12.8 0 0 0-12.8-12.8h-211.2V192c0-47.36-38.4-85.76-85.76-85.76z" />
    </svg>
  );
}

const SettingsSearchContext = createContext('');

const NAV_ICONS = {
  general: <SettingOutlined />,
  appearance: <AppearanceIcon />,
  editor: <CodeIcon />,
  renderer: <PaletteIcon />,
  shortcuts: <ShortcutsIcon />,
  languages: <PluginsIcon />,

  about: <InfoCircleOutlined />,
};

const NAV_KEYS = ['general', 'appearance', 'editor', 'renderer', 'shortcuts', 'languages', 'about'];

const SETTINGS_VIEW_STORAGE_KEY = 'mokidown-settings-view';

function readSettingsView() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_VIEW_STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

function storeSettingsView(patch) {
  try {
    const current = readSettingsView() || {};
    localStorage.setItem(SETTINGS_VIEW_STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {
    // 忽略隐私模式或存储配额错误。
  }
}

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
  const [activeNav, setActiveNav] = useState(() => {
    const saved = readSettingsView();
    return NAV_KEYS.includes(saved?.nav) ? saved.nav : 'general';
  });
  const [direction, setDirection] = useState('right');
  const [searching, setSearching] = useState(() => Boolean(readSettingsView()?.searching));
  const [query, setQuery] = useState(() => readSettingsView()?.query || '');
  const [matchIndex, setMatchIndex] = useState(() => Number(readSettingsView()?.matchIndex) || 0);
  const contentRef = useRef(null);

  useEffect(() => {
    storeSettingsView({ searching, query, matchIndex });
  }, [searching, query, matchIndex]);

  useEffect(() => () => window.clearTimeout(clearSearchTimer.current), []);

  useEffect(() => {
    const saved = readSettingsView();
    if (!saved?.scrollTop) return undefined;
    const frame = requestAnimationFrame(() => {
      if (contentRef.current) contentRef.current.scrollTop = saved.scrollTop;
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const clearSearchTimer = useRef(0);
  const closeSearch = () => {
    setSearching(false);
    setMatchIndex(0);
    // 关闭动画期间保留搜索词，折叠结束后再清空。
    window.clearTimeout(clearSearchTimer.current);
    clearSearchTimer.current = window.setTimeout(() => setQuery(''), 240);
  };
  const openSearch = () => {
    window.clearTimeout(clearSearchTimer.current);
    setSearching(true);
  };
  const activeNavRef = useRef(activeNav);
  const activateNav = useCallback((key) => {
    if (key === activeNavRef.current) return;
    const index = NAV_KEYS.indexOf(key);
    setDirection(
      index !== 0 &&
        (index === NAV_KEYS.length - 1 || index < NAV_KEYS.indexOf(activeNavRef.current))
        ? 'left'
        : 'right',
    );
    activeNavRef.current = key;
    storeSettingsView({ nav: key, scrollTop: contentRef.current?.scrollTop ?? 0 });
    const update = () => setActiveNav(key);
    if (
      typeof document.startViewTransition === 'function' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      document.startViewTransition(() => flushSync(update));
    } else update();
  }, []);
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
  const pickWorkspaceDirectory = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === 'string' && selected) {
        handleChange('workspacePath', selected);
      }
    } catch (error) {
      console.warn('[settings] Failed to pick workspace directory:', error);
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
            onSearch={openSearch}
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
          <div
            className="settings-modal__content"
            ref={contentRef}
            onScroll={(event) =>
              storeSettingsView({
                nav: activeNavRef.current,
                scrollTop: event.currentTarget.scrollTop,
              })
            }
          >
            <div className="settings-modal__pane" key={activeNav} data-direction={direction}>
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
                      className="settings-path-input"
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
                    <AutoWidthSelect
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
                      className="settings-path-input"
                      value={config.workspacePath}
                      onChange={(e) => handleChange('workspacePath', e.target.value)}
                      placeholder="/path/to/workspace"
                      suffix={
                        <Tooltip title={t('settings.editor.chooseFolder')} placement="top">
                          <Button
                            type="text"
                            size="small"
                            icon={<FolderOpenOutlined />}
                            aria-label={t('settings.editor.chooseFolder')}
                            onClick={() => void pickWorkspaceDirectory()}
                          />
                        </Tooltip>
                      }
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
                          className="settings-path-input"
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
                    <AutoWidthSelect
                      aria-label={t('settings.general.associatedOpenMode')}
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
                      <AutoWidthSelect
                        aria-label={t('settings.general.externalFileDrag')}
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
                      checked={config.restoreLastSession !== false}
                      onChange={(v) => handleChange('restoreLastSession', v)}
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
                    <AutoWidthSelect
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
                      <AutoWidthSelect
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
                    <AutoWidthSelect
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
const selectLabelText = (label) => {
  if (label == null || typeof label === 'boolean') return '';
  if (typeof label === 'string' || typeof label === 'number') return String(label);
  if (Array.isArray(label)) return label.map(selectLabelText).join('');
  if (label.props) return selectLabelText(label.props.children);
  return '';
};

const selectTextWidth = (text) =>
  [...String(text)].reduce(
    (sum, char) => sum + (/[\u3000-\u9fff\uff00-\uffef]/.test(char) ? 14 : 8),
    0,
  );

/** 下拉宽度按最长候选项计算，中英文自适应，避免省略号截断。 */
function AutoWidthSelect({ options = [], style, className, ...props }) {
  const width = Math.max(
    56,
    ...options.map((option) => selectTextWidth(selectLabelText(option?.label)) + 48),
  );
  return (
    <Select
      {...props}
      className={`settings-auto-width-select${className ? ` ${className}` : ''}`}
      options={options}
      popupMatchSelectWidth={false}
      style={{ width, maxWidth: '100%', ...style }}
    />
  );
}

function FontSizeControl({ label, value, onChange, disabled = false }) {
  const digits = String(value ?? '').length;
  return (
    <InputNumber
      className="setting-font-size-input"
      aria-label={label}
      min={10}
      max={24}
      step={1}
      disabled={disabled}
      value={value}
      onChange={onChange}
      style={{ width: Math.max(58, 36 + digits * 12) }}
    />
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
