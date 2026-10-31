import {
  folderNames,
  folderNamesExpanded,
} from 'material-icon-theme/dist/material-icons.json';

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
 * 上游 5.40 提供了图标文件，但 folderNames 没登记对应目录名的情况。
 * 只补 folder-* 图标（保持文件夹形状），不使用文件/品牌图标充当目录图标。
 */
const FOLDER_ALIASES = {
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
};

export function getFolderIconUrl(folderName = '', isExpanded = false) {
  const name = String(folderName).replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop().toLowerCase();
  const names = isExpanded ? folderNamesExpanded : folderNames;
  if (Object.hasOwn(names, name)) return iconUrls[names[name]] || null;

  const alias = FOLDER_ALIASES[name];
  if (alias) return iconUrls[isExpanded ? `${alias}-open` : alias] || iconUrls[alias] || null;

  return null;
}
