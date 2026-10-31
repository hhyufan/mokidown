/**
 * 目录图标生成脚本（设计阶段，不修改 src/）。
 * 运行：node design/folder-icons/generate.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ICONS = 'node_modules/material-icon-theme/icons';
const OUT = 'design/folder-icons';
const GH = 'C:/Program Files/GitHub CLI/gh.exe';
const FOLDER_D =
  'm6.922 3.768-.644-.536A1 1 0 0 0 5.638 3H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H7.562a1 1 0 0 1-.64-.232';

function api(path) {
  return execSync(`"${GH}" api "${path}"`, {
    encoding: 'utf8',
    maxBuffer: 40 * 1024 * 1024,
    env: { ...process.env, HTTPS_PROXY: '', HTTP_PROXY: '', ALL_PROXY: '' },
  });
}
function remoteFile(repo, file) {
  const json = JSON.parse(api(`repos/${repo}/contents/${file}`));
  return Buffer.from(String(json.content).replace(/\s+/g, ''), 'base64').toString('utf8');
}

// 海豚：vscode-icons 的 MySQL 文件夹里，白色 + #f3fdff 两段拼成完整海豚。
const mysqlFolderSvg = remoteFile('vscode-icons/vscode-icons', 'icons/folder_type_mysql.svg');
const dolphinPaths = [...mysqlFolderSvg.matchAll(/<path[^>]*(?:fill="#fff"[^>]*|fill="#f3fdff"[^>]*)\sd="([^"]+)"/g)].map((m) => m[1]);
if (dolphinPaths.length < 2) {
  // path 的 fill 可能写在 d 之后，再宽松抓一次。
  const fallback = [...mysqlFolderSvg.matchAll(/<path[^>]*d="([^"]+)"[^>]*fill="#(?:fff|f3fdff)"/g)].map((m) => m[1]);
  dolphinPaths.push(...fallback);
}

// Java 分层目录（参考 Atom Material Icons 截图配色，图形用库内齿轮/几何自绘）
const JAVA_ITEMS = [
  { name: 'annotation', type: 'java', note: '自绘：参考 Atom Material Icons 截图的配色与图形', color: '#9c27b0', motive: 'at' },
  { name: 'aspect', type: 'java', note: '自绘：参考 Atom Material Icons 截图的配色与图形', color: '#b0bec5', motive: 'plain' },
  { name: 'chain', type: 'java', note: '自绘：参考 Atom Material Icons 截图的配色与图形', color: '#b0bec5', motive: 'plain' },
  { name: 'config', type: 'java', note: '自绘：参考 Atom Material Icons 截图的配色与图形', color: '#26a69a', motive: 'gear' },
  { name: 'context', type: 'java', note: '自绘：参考 Atom Material Icons 截图的配色与图形', color: '#26a69a', motive: 'list' },
  { name: 'controller', type: 'java', note: '自绘：参考 Atom Material Icons 截图的配色与图形', color: '#e91e63', motive: 'gear' },
  { name: 'dto', type: 'java', note: '自绘：参考 Atom Material Icons 截图的配色与图形', color: '#26a69a', motive: 'document' },
  { name: 'entity', type: 'java', note: '自绘：参考 Atom Material Icons 截图的配色与图形', color: '#26a69a', motive: 'document' },
  { name: 'enums', type: 'java', note: '自绘：参考 Atom Material Icons 截图的配色与图形', color: '#78909c', motive: 'bars' },
  { name: 'exception', type: 'java', note: '自绘：参考 Atom Material Icons 截图的配色与图形', color: '#ef5350', motive: 'alert' },
  { name: 'extension', type: 'java', note: '自绘：参考 Atom Material Icons 截图的配色与图形', color: '#26a69a', motive: 'gear' },
  { name: 'filter', type: 'java', note: '自绘：参考 Atom Material Icons 截图的配色与图形', color: '#26a69a', motive: 'funnel' },
  { name: 'global', type: 'java', note: '自绘：参考 Atom Material Icons 截图的配色与图形', color: '#7e57c2', motive: 'globe' },
  { name: 'handler', type: 'java', note: '自绘：参考 Atom Material Icons 截图的配色与图形', color: '#29b6f6', motive: 'gear' },
  { name: 'listener', type: 'java', note: '自绘：参考 Atom Material Icons 截图的配色与图形', color: '#b0bec5', motive: 'plain' },
  { name: 'mapper', type: 'java', note: '自绘：参考 Atom Material Icons 截图的配色与图形', color: '#26a69a', motive: 'table' },
  { name: 'point', type: 'java', note: '自绘：参考 Atom Material Icons 截图的配色与图形', color: '#b0bec5', motive: 'plain' },
  { name: 'request', type: 'java', note: '自绘：参考 Atom Material Icons 截图的配色与图形', color: '#ffa726', motive: 'list' },
  { name: 'response', type: 'java', note: '自绘：参考 Atom Material Icons 截图的配色与图形', color: '#b0bec5', motive: 'plain' },
  { name: 'runner', type: 'java', note: '自绘：参考 Atom Material Icons 截图的配色与图形', color: '#b0bec5', motive: 'plain' },
  { name: 'service', type: 'java', note: '自绘：参考 Atom Material Icons 截图的配色与图形', color: '#29b6f6', motive: 'gear' },
  { name: 'util', type: 'java', note: '自绘：参考 Atom Material Icons 截图的配色与图形', color: '#78909c', motive: 'arrow' },
  { name: 'wrapper', type: 'java', note: '自绘：参考 Atom Material Icons 截图的配色与图形', color: '#b0bec5', motive: 'plain' },
];
const items = [
  ...JAVA_ITEMS,
  { name: '.mvn', type: 'copy', src: 'src/assets/file-icons/folder-mvn.svg', note: '自建：material 的 Maven 羽毛路径，单色填充' },
  { name: '.sys', type: 'custom', svg: 'windows', color: '#607d8b', note: '自绘：Windows 四格窗（系统/驱动文件）' },
  { name: '.csharp', type: 'copy', src: 'src/assets/file-icons/folder-csharp.svg', note: '自建：csharp.svg 路径 + 品牌紫文件夹' },
  { name: 'mybatis', type: 'glyph', color: '#dc382d', motive: '#ffcdd2', glyph: 'M', note: '自建组合：文件夹 + 品牌字母「M」' },
  { name: 'mysql', type: 'dolphin-folder', color: '#00758f', motive: '#b2ebf2', note: '自建组合：material 文件夹 + vscode-icons 的海豚路径（与文件图标同一海豚）' },
  { name: 'mysql 文件', type: 'dolphin-file', color: '#00758f', note: '自绘组合：海豚文件图标（.pdb / .frm / .ibd / .myd 等 MySQL 文件共用）' },
  { name: 'spring', type: 'devicon', repo: 'devicons/devicon', path: 'icons/spring/spring-original.svg', color: '#6db33f', motive: '#e8f5e9', note: '自建组合：material 文件夹 + devicon 的 Spring 叶子' },
  { name: 'ssh', type: 'copy', src: `${ICONS}/folder-console.svg`, note: '库内现成 folder-console.svg（终端/远程）' },
  { name: 'Users', type: 'users', color: '#546e7a', motive: '#cfd8dc', note: '自建组合：文件夹 + 双人形轮廓' },
  { name: 'home', type: 'copy', src: `${ICONS}/folder-home.svg`, note: '库内现成 folder-home.svg（主目录）' },
  { name: 'user', type: 'user', color: '#546e7a', motive: '#cfd8dc', note: '自建组合：文件夹 + 单人形轮廓' },
  { name: '.swidtag', type: 'custom', svg: 'tag', color: '#8d6e63', note: '自绘：软件标识标签（SWID tag）' },
  { name: 'zh', type: 'glyph', color: '#d32f2f', motive: '#ffcdd2', glyph: '文', note: '自建组合：文件夹 + 文字「文」' },
  { name: 'en', type: 'font-a', color: '#1976d2', motive: '#bbdefb', note: '参考 folder-font：蓝文件夹 + 浅蓝 A 字形（复用 folder-font 的字母路径，换色）' },
  { name: 'tomcat', type: 'devicon-multi', repo: 'devicons/devicon', path: 'icons/tomcat/tomcat-original.svg', color: '#f8b62d', note: '自建组合：品牌橙文件夹 + devicon 的彩色 Tomcat' },
  { name: 'python', type: 'copy', src: `${ICONS}/folder-python.svg`, note: '库内现成 folder-python.svg' },
  { name: 'jdk', type: 'copy', src: `${ICONS}/folder-java.svg`, note: '库内现成 folder-java.svg（JDK 直接用）' },
  { name: 'kotlin', type: 'copy', src: `${ICONS}/folder-kotlin.svg`, note: '库内现成 folder-kotlin.svg' },
  { name: 'kotlinc', type: 'copy', src: `${ICONS}/folder-kotlin.svg`, note: '复用库内 folder-kotlin.svg（Kotlin 编译器目录）' },
  { name: 'NDK', type: 'copy', src: `${ICONS}/folder-android.svg`, note: '库内现成 folder-android.svg（Android NDK）' },
  { name: 'share', type: 'copy', src: `${ICONS}/folder-shared.svg`, note: '库内现成 folder-shared.svg' },
  { name: 'charsets', type: 'copy', src: `${ICONS}/folder-font.svg`, note: '库内语义 folder-font.svg（字符集/字体）' },
  { name: 'default', type: 'copy', src: `${ICONS}/folder-config.svg`, note: '库内语义 folder-config.svg（默认配置）' },
  { name: 'AppData', type: 'copy', src: `${ICONS}/folder-windows.svg`, note: '库内现成 folder-windows.svg（Windows 系统目录）' },
  { name: 'Local', type: 'copy', src: `${ICONS}/folder-windows.svg`, note: '复用 folder-windows.svg' },
  { name: 'Roming', type: 'copy', src: `${ICONS}/folder-windows.svg`, note: '复用 folder-windows.svg（Roaming）' },
  { name: 'Microsoft', type: 'copy', src: `${ICONS}/folder-windows.svg`, note: '复用 folder-windows.svg' },
  { name: 'NetWork', type: 'copy', src: `${ICONS}/folder-server.svg`, note: '库内语义 folder-server.svg（网络目录）' },
  { name: 'dist', type: 'copy', src: `${ICONS}/folder-dist.svg`, note: '库内现成 folder-dist.svg' },
  { name: 'artifacts', type: 'copy', src: `${ICONS}/folder-packages.svg`, note: '库内语义 folder-packages.svg（构建产物）' },
  { name: 'sites', type: 'copy', src: `${ICONS}/folder-public.svg`, note: '库内语义 folder-public.svg（站点）' },
  { name: 'installer', type: 'copy', src: `${ICONS}/folder-download.svg`, note: '库内语义 folder-download.svg（安装包）' },
  { name: 'image', type: 'copy', src: `${ICONS}/folder-images.svg`, note: '库内现成 folder-images.svg（模糊匹配 *image*）' },
];

const MOTIVES = {
  plain: () => '',
  at: () => '<text x="10.5" y="13.1" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="7.2" font-weight="700" fill="#fff">@</text>',
  gear: (d) => '<g transform="translate(10.65 9.65) scale(0.175)" fill="#fff" opacity="0.92"><path d="' + d + '"/></g>',
  document: () => '<g fill="none" stroke="#fff" stroke-width="1" opacity="0.92"><rect x="6.4" y="5.8" width="7.2" height="7.6" rx="0.8"/><path d="M7.8 8.2h4.4M7.8 10h4.4M7.8 11.8h2.8"/></g>',
  list: () => '<g stroke="#fff" stroke-width="1.1" stroke-linecap="round" opacity="0.92"><path d="M6.4 7h7.2M6.4 9.2h7.2M6.4 11.4h4.8"/></g>',
  alert: () => '<g fill="none" stroke="#fff" stroke-width="1.1" opacity="0.92"><circle cx="10.5" cy="10" r="3.6"/><path d="M10.5 7.9v2.6"/><circle cx="10.5" cy="12.1" r="0.55" fill="#fff" stroke="none"/></g>',
  funnel: () => '<path fill="#fff" opacity="0.92" d="M6.2 6.2h8.4l-3.2 3.8v3.4l-2.2-1.1V10Z"/>',
  globe: () => '<g fill="none" stroke="#fff" stroke-width="1" opacity="0.92"><circle cx="10.5" cy="10" r="3.4"/><path d="M7.1 10h6.8M10.5 6.6c1.7 1.9 1.7 4.9 0 6.8M10.5 6.6c-1.7 1.9-1.7 4.9 0 6.8"/></g>',
  bars: () => '<g fill="#fff" opacity="0.92"><rect x="6.6" y="6.6" width="1.2" height="6.4" rx="0.4"/><rect x="9.9" y="6.6" width="1.2" height="6.4" rx="0.4"/><rect x="13.2" y="6.6" width="1.2" height="6.4" rx="0.4"/></g>',
  table: () => '<g fill="none" stroke="#fff" stroke-width="1" opacity="0.92"><rect x="6" y="6" width="8" height="7.2" rx="0.6"/><path d="M6 8.4h8M6 10.8h8M9.3 6v7.2"/></g>',
  arrow: () => '<g fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.92"><path d="M6 8h7M10.8 6.4 13 8l-2.2 1.6"/></g>',
};
function folderBase(color) {
  return `<path id="folder" fill="${color}" d="${FOLDER_D}"/>`;
}

function userMotive(color, dual = false) {
  if (!dual) {
    return `<circle cx="10.7" cy="7.3" r="1.7" fill="${color}"/><path fill="${color}" d="M7.5 12.9a3.2 3.2 0 0 1 6.4 0Z"/>`;
  }
  return `<circle cx="9.3" cy="7.1" r="1.5" fill="${color}"/><path fill="${color}" d="M6.4 12.9a2.9 2.9 0 0 1 5.8 0Z"/><circle cx="13.1" cy="7.6" r="1.3" fill="${color}" opacity="0.75"/><path fill="${color}" opacity="0.75" d="M10.7 12.9a2.5 2.5 0 0 1 5 0Z"/>`;
}

const CUSTOM = {
  windows: (color) =>
    `<g fill="${color}"><rect x="2.2" y="2.2" width="5.2" height="5.2" rx="0.7"/><rect x="8.6" y="2.2" width="5.2" height="5.2" rx="0.7"/><rect x="2.2" y="8.6" width="5.2" height="5.2" rx="0.7"/><rect x="8.6" y="8.6" width="5.2" height="5.2" rx="0.7"/></g>`,
  tag: (color) =>
    `<path fill="${color}" d="M2.4 4.2a1 1 0 0 1 1-1h6.2l4 4.3a1 1 0 0 1 0 1.4l-3.6 4a1 1 0 0 1-1.5 0L2.7 8.5a1 1 0 0 1-.3-.7Z"/><circle cx="4.7" cy="6.3" r="0.9" fill="#fff"/>`,
};

function deviconPaths(svg, fallbackFill) {
  const body = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '');
  if (fallbackFill) return body.replace(/<path(?![^>]*fill=)/g, `<path fill="${fallbackFill}"`);
  return body;
}

/** 海豚几何：vscode-icons 32 视口，路径包围盒约 x 5..31、y 13..31。 */
function dolphinMarkup(fill, transform) {
  return `<g id="motive" fill="${fill}" transform="${transform}">${dolphinPaths.map((d) => `<path d="${d}"/>`).join('')}</g>`;
}

const gearPath = [...fs.readFileSync(`${ICONS}/settings.svg`, 'utf8').matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1])[0];

const manifest = [];
const rows = [];
for (const item of items) {
  const base = item.name.replace(/^\W+/, '').replace(/\s+/g, '-').toLowerCase();
  const fileName = item.name === 'mysql 文件' ? 'mysql-dolphin.svg' : `${base}.svg`;
  const outPath = path.join(OUT, fileName);
  let sourceImg = 'self';

  if (item.type === 'copy') {
    fs.copyFileSync(item.src, outPath);
    sourceImg = item.src.replace(/^node_modules/, '../../node_modules').replace(/^src\//, '../../src/');
  } else if (item.type === 'custom') {
    fs.writeFileSync(outPath, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${CUSTOM[item.svg](item.color)}</svg>\n`);
  } else if (item.type === 'user' || item.type === 'users') {
    fs.writeFileSync(outPath, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${folderBase(item.color)}<g id="motive">${userMotive(item.motive, item.type === 'users')}</g></svg>\n`);
  } else if (item.type === 'font-a') {
    const aPath = [...fs.readFileSync(`${ICONS}/folder-font.svg`, 'utf8').matchAll(/<path[^>]*id="motive"[^>]*d="([^"]+)"/g)].map((m) => m[1])[0];
    fs.writeFileSync(outPath, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${folderBase(item.color)}<path id="motive" fill="${item.motive}" d="${aPath}"/></svg>\n`);
    sourceImg = `../../node_modules/material-icon-theme/icons/folder-font.svg`;
  } else if (item.type === 'glyph') {
    const fontSize = item.glyph.length > 1 ? 6.2 : 7.4;
    fs.writeFileSync(outPath, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${folderBase(item.color)}<text id="motive" x="10.5" y="13.2" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="${item.motive}">${item.glyph}</text></svg>\n`);
  } else if (item.type === 'java') {
    const motive = (MOTIVES[item.motive] || MOTIVES.plain)(gearPath);
    fs.writeFileSync(outPath, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${folderBase(item.color)}${motive}</svg>\n`);
  } else if (item.type === 'dolphin-folder') {
    fs.writeFileSync(outPath, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${folderBase(item.color)}${dolphinMarkup(item.motive, 'translate(2.4 0.14) scale(0.42)')}</svg>\n`);
  } else if (item.type === 'dolphin-file') {
    fs.writeFileSync(outPath, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${dolphinMarkup(item.color, 'translate(-1.9 -4.1) scale(0.55)')}</svg>\n`);
    sourceImg = 'vscode-icons dolphin';
  } else if (item.type === 'brand') {
    const d = [...fs.readFileSync(`${ICONS}/${item.icon}.svg`, 'utf8').matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1])[0];
    const content = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${folderBase(item.color)}<g id="motive" fill="${item.motive}" transform="translate(4.1 4.6) scale(0.42)"><path d="${d}"/></g></svg>`;
    fs.writeFileSync(outPath, content + '\n');
    sourceImg = `../../node_modules/material-icon-theme/icons/${item.icon}.svg`;
  } else if (item.type === 'devicon' || item.type === 'devicon-multi') {
    const svg = remoteFile(item.repo, item.path);
    const inner = deviconPaths(svg, item.type === 'devicon' ? item.motive : null);
    const scale = 0.085;
    const tx = 10.5 - 128 * scale / 2;
    const ty = 9.5 - 128 * scale / 2;
    fs.writeFileSync(outPath, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${folderBase(item.color)}<g id="motive" transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale})">${inner}</g></svg>\n`);
    sourceImg = `${item.repo}:${item.path}`;
  }
  manifest.push({ name: item.name, file: fileName, type: item.type, source: item.note });
  rows.push({ item, fileName, sourceImg });
}

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

const rowHtml = rows.map(({ item, fileName, sourceImg }) => {
  let sourceCell;
  if (sourceImg === 'self') sourceCell = '<span class="self">自绘（SVG 几何/文字）</span>';
  else if (sourceImg === 'vscode-icons dolphin') sourceCell = '<span class="src">vscode-icons/folder_type_mysql.svg 的海豚路径</span>';
  else if (sourceImg.startsWith('devicons') || sourceImg.startsWith('vscode-icons')) sourceCell = `<span class="src">${sourceImg}</span>`;
  else sourceCell = `<img src="${sourceImg}" width="32" height="32"><span class="src">${sourceImg}</span>`;
  return `<tr><td class="name">${item.name}</td><td>${sourceCell}</td><td>${item.note}</td><td><img src="./${fileName}" width="72" height="72"></td><td><img src="./${fileName}" width="16" height="16"></td></tr>`;
}).join('\n');

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>目录图标对比</title>
<style>
body{margin:24px;background:#f6f6f8;color:#222;font:13px/1.5 system-ui,'Segoe UI',sans-serif}
h1{font-size:18px;margin:0 0 6px}p.meta{color:#666;margin:0 0 16px}
table{border-collapse:collapse;width:100%;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.06)}
th,td{padding:8px 10px;border-bottom:1px solid #eee;vertical-align:middle;text-align:left}
th{background:#fafafa;font-weight:600;font-size:12px;color:#444}
td.name{font-family:Consolas,monospace;font-weight:600}
td img{display:block;background:#f2f2f4;border-radius:6px}
td .src{display:inline-block;margin-left:8px;color:#888;font-size:11px;word-break:break-all;max-width:420px;vertical-align:middle}
td .self{color:#b00;font-size:11px}
.legend{display:flex;gap:18px;color:#666;font-size:12px;margin:0 0 12px}
</style></head><body>
<h1>目录图标设计对比（未应用）</h1>
<p class="meta">${items.length} 项 · 最终 SVG 位于 design/folder-icons/ · 源图标：material-icon-theme / devicon / vscode-icons</p>
<div class="legend"><span>① 选择的源 SVG</span><span>② 来源（库内现成 / 自建组合 / 自绘）</span><span>③ 最终效果（72px）</span><span>16px</span></div>
<table>
<tr><th>目录 / 模式</th><th>① 源 SVG 图标</th><th>② 来源</th><th>③ 最终</th><th>16px</th></tr>
${rowHtml}
</table>
</body></html>`;
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log(`generated ${items.length} icons + index.html`);
