/**
 * @file 文件图标映射：直接使用 material-icon-theme 的完整映射表。
 *
 * 目录图标在 folderIcons.js 里走同一份数据，这里补上文件维度：
 * 先按文件名（Dockerfile、.gitignore 等），再按扩展名（rs、csproj、mdx 等），
 * 命中后返回对应 SVG 的打包 URL，未命中返回 null 由上层回退。
 */
import {
  fileNames,
  fileExtensions,
  iconDefinitions,
} from 'material-icon-theme/dist/material-icons.json';

// 只引用图标资源，不把 SVG 内联进 JS；Vite 会为每个文件生成一个 URL。
const assets = import.meta.glob('/node_modules/material-icon-theme/icons/*.svg', {
  eager: true,
  query: '?url&no-inline',
  import: 'default',
});

/** 图标文件名（不含 .svg）→ 打包后的 URL。 */
const iconUrls = Object.fromEntries(
  Object.entries(assets).map(([path, url]) => [
    path.split('/').pop().replace(/\.svg$/, ''),
    url,
  ]),
);

/** 文件名映射的小写索引：官方键区分大小写，这里兜底一次大小写不敏感匹配。 */
const lowerFileNames = new Map(
  Object.entries(fileNames).map(([name, icon]) => [name.toLowerCase(), icon]),
);

/** 扩展名映射的小写索引，处理 `.TS`、`.Rs` 这类大写写法。 */
const lowerExtensions = new Map(
  Object.entries(fileExtensions).map(([extension, icon]) => [extension.toLowerCase(), icon]),
);

/** 图标定义名 → SVG URL。 */
function iconUrl(iconName) {
  if (!iconName) return null;
  const path = iconDefinitions[iconName]?.iconPath;
  if (!path) return null;
  const base = path.split('/').pop().replace(/\.svg$/, '');
  return iconUrls[base] || null;
}

/**
 * 解析文件对应的图标 URL。
 * @param {string} fileName 文件名（含扩展名，可带路径）。
 * @param {string} extension 显式扩展名（可带前导点），优先于文件名推断。
 * @returns {string|null} 图标 URL，未命中时为 null。
 */
export function getFileIconUrl(fileName = '', extension = '') {
  const name = String(fileName || '').split(/[\\/]/).pop().trim();
  if (!name) return null;

  // 1. 精确文件名（如 package.json、.gitignore、Dockerfile）。
  const exact = fileNames[name];
  if (exact) {
    const url = iconUrl(exact);
    if (url) return url;
  }

  // 2. 文件名大小写不敏感（makefile / MAKEFILE）。
  const insensitive = lowerFileNames.get(name.toLowerCase());
  if (insensitive) {
    const url = iconUrl(insensitive);
    if (url) return url;
  }

  // 3. 扩展名：显式传入优先，否则取文件名最后一段。
  const raw = String(extension || '').trim() || (name.includes('.') ? name.split('.').pop() : '');
  const normalized = raw.replace(/^\./, '').toLowerCase();
  if (!normalized) return null;
  return iconUrl(lowerExtensions.get(normalized) || fileExtensions[normalized]) || null;
}
