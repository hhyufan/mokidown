import {
  folderNames,
  folderNamesExpanded,
} from 'material-icon-theme/dist/material-icons.json';
import folderCsharpUrl from '../assets/file-icons/folder-csharp.svg?url';
import folderMvnUrl from '../assets/file-icons/folder-mvn.svg?url';
import folderMysqlUrl from '../assets/file-icons/mysql.svg?url';
import folderTomcatUrl from '../assets/file-icons/tomcat.svg?url';
import folderEnUrl from '../assets/file-icons/en.svg?url';
import folderZhUrl from '../assets/file-icons/zh.svg?url';
import folderUsersUrl from '../assets/file-icons/users.svg?url';
import folderUserUrl from '../assets/file-icons/user.svg?url';

// Only bundle folder assets. Keep SVGs as local files instead of inlining the
// entire collection into JavaScript; Vite also resolves these URLs in web demos.
const assets = import.meta.glob('/node_modules/material-icon-theme/icons/folder*.svg', {
  eager: true,
  query: '?url&no-inline',
  import: 'default',
});
const iconUrls = Object.fromEntries(
  Object.entries(assets).map(([path, url]) => [
    path.split('/').pop().replace(/(?:\.clone)?\.svg$/, ''),
    url,
  ]),
);

/**
 * 上游有图标、但 folderNames 没登记目录名的情况（含跨库语义映射）。
 * 只补 folder-* 图标（保持文件夹形状），不使用文件/品牌图标充当目录图标。
 */
const FOLDER_ALIASES = {
  // React / Redux / NGRX / Vuex（上游有图标但未登记）
  react: 'folder-react-components',
  'react-components': 'folder-react-components',
  redux: 'folder-redux-actions',
  'redux-actions': 'folder-redux-actions',
  'redux-reducer': 'folder-redux-reducer',
  'redux-selector': 'folder-redux-selector',
  'redux-store': 'folder-redux-store',
  'redux-toolkit': 'folder-redux-toolkit',
  ngrx: 'folder-ngrx-store',
  'ngrx-actions': 'folder-ngrx-actions',
  'ngrx-effects': 'folder-ngrx-effects',
  'ngrx-entities': 'folder-ngrx-entities',
  'ngrx-reducer': 'folder-ngrx-reducer',
  'ngrx-selectors': 'folder-ngrx-selectors',
  'ngrx-state': 'folder-ngrx-state',
  'ngrx-store': 'folder-ngrx-store',
  state: 'folder-ngrx-state',
  vuex: 'folder-vuex-store',
  'vuex-store': 'folder-vuex-store',
  'vue-directives': 'folder-vue-directives',
  root: 'folder-root',
  // 常用目录的语义映射
  ssh: 'folder-console',
  charsets: 'folder-font',
  default: 'folder-config',
  appdata: 'folder-windows',
  local: 'folder-windows',
  roming: 'folder-windows',
  microsoft: 'folder-windows',
  network: 'folder-server',
  artifacts: 'folder-packages',
  sites: 'folder-public',
  installer: 'folder-download',
  jdk: 'folder-java',
  kotlinc: 'folder-kotlin',
  ndk: 'folder-android',
  share: 'folder-shared',
};

/**
 * 本地补充的文件夹图标（官方没有对应 folder-*，或需要换色/组合）。
 * 颜色与图形见 design/folder-icons/generate.mjs。
 */
const LOCAL_FOLDER_ICONS = {
  csharp: folderCsharpUrl,
  'c-sharp': folderCsharpUrl,
  cs: folderCsharpUrl,
  dotnet: folderCsharpUrl,
  mvn: folderMvnUrl,
  '.mvn': folderMvnUrl,
  maven: folderMvnUrl,
  mysql: folderMysqlUrl,
  tomcat: folderTomcatUrl,
  en: folderEnUrl,
  english: folderEnUrl,
  zh: folderZhUrl,
  users: folderUsersUrl,
  user: folderUserUrl,
};

export function getFolderIconUrl(folderName = '', isExpanded = false) {
  const name = String(folderName).replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop().toLowerCase();
  const names = isExpanded ? folderNamesExpanded : folderNames;
  if (Object.hasOwn(names, name)) return iconUrls[names[name]] || null;

  const alias = FOLDER_ALIASES[name];
  if (alias) return iconUrls[isExpanded ? `${alias}-open` : alias] || iconUrls[alias] || null;

  const local = LOCAL_FOLDER_ICONS[name];
  if (local) return local;

  return null;
}
