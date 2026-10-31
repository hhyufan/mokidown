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
 * 上游 5.40 提供了 folder-react-components / folder-redux-* / folder-ngrx-state
 * 图标，但 folderNames 里没有对应的目录名，导致这些常见目录退回默认图标。
 * 这里补一层别名，只补数据缺失，不改上游图标语义。
 */
const FOLDER_ALIASES = {
  react: 'folder-react-components',
  'react-components': 'folder-react-components',
  redux: 'folder-redux-actions',
  state: 'folder-ngrx-state',
};

export function getFolderIconUrl(folderName = '', isExpanded = false) {
  const name = String(folderName).replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop().toLowerCase();
  const names = isExpanded ? folderNamesExpanded : folderNames;
  if (Object.hasOwn(names, name)) return iconUrls[names[name]] || null;

  const alias = FOLDER_ALIASES[name];
  if (alias) return iconUrls[isExpanded ? `${alias}-open` : alias] || iconUrls[alias] || null;
  return null;
}
