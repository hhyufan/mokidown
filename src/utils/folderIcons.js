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

// 语言/技术栈目录没有 folder-* 图标时，退回同名的品牌图标（文件图标）。
// 上游只提供了 csharp.svg / visualstudio.svg，没有 folder-csharp。
const brandAssets = import.meta.glob([
  '/node_modules/material-icon-theme/icons/csharp.svg',
  '/node_modules/material-icon-theme/icons/visualstudio.svg',
], {
  eager: true,
  query: '?url&no-inline',
  import: 'default',
});
const brandUrls = Object.fromEntries(
  Object.entries(brandAssets).map(([path, url]) => [
    path.split('/').pop().replace(/\.svg$/, ''),
    url,
  ]),
);

/**
 * 上游 5.40 提供了图标文件，但 folderNames 没登记对应目录名的情况。
 * 这里只补数据缺口，语义按图标本身的含义来。
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

/** 目录名直接对应品牌图标（没有 folder-* 版本时）。 */
const BRAND_FOLDERS = {
  csharp: 'csharp',
  'c-sharp': 'csharp',
  cs: 'csharp',
  dotnet: 'visualstudio',
  '.net': 'visualstudio',
};

export function getFolderIconUrl(folderName = '', isExpanded = false) {
  const name = String(folderName).replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop().toLowerCase();
  const names = isExpanded ? folderNamesExpanded : folderNames;
  if (Object.hasOwn(names, name)) return iconUrls[names[name]] || null;

  const alias = FOLDER_ALIASES[name];
  if (alias) return iconUrls[isExpanded ? `${alias}-open` : alias] || iconUrls[alias] || null;

  const brand = BRAND_FOLDERS[name];
  if (brand) return brandUrls[brand] || null;

  return null;
}
