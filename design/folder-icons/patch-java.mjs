import fs from 'node:fs';

const p = 'design/folder-icons/generate.mjs';
let s = fs.readFileSync(p, 'utf8');

const javaItems = [
  "  { name: 'annotation', type: 'java', color: '#9c27b0', motive: 'at' },",
  "  { name: 'aspect', type: 'java', color: '#b0bec5', motive: 'plain' },",
  "  { name: 'chain', type: 'java', color: '#b0bec5', motive: 'plain' },",
  "  { name: 'config', type: 'java', color: '#26a69a', motive: 'gear' },",
  "  { name: 'context', type: 'java', color: '#26a69a', motive: 'list' },",
  "  { name: 'controller', type: 'java', color: '#e91e63', motive: 'gear' },",
  "  { name: 'dto', type: 'java', color: '#26a69a', motive: 'document' },",
  "  { name: 'entity', type: 'java', color: '#26a69a', motive: 'document' },",
  "  { name: 'enums', type: 'java', color: '#78909c', motive: 'bars' },",
  "  { name: 'exception', type: 'java', color: '#ef5350', motive: 'alert' },",
  "  { name: 'extension', type: 'java', color: '#26a69a', motive: 'gear' },",
  "  { name: 'filter', type: 'java', color: '#26a69a', motive: 'funnel' },",
  "  { name: 'global', type: 'java', color: '#7e57c2', motive: 'globe' },",
  "  { name: 'handler', type: 'java', color: '#29b6f6', motive: 'gear' },",
  "  { name: 'listener', type: 'java', color: '#b0bec5', motive: 'plain' },",
  "  { name: 'mapper', type: 'java', color: '#26a69a', motive: 'table' },",
  "  { name: 'point', type: 'java', color: '#b0bec5', motive: 'plain' },",
  "  { name: 'request', type: 'java', color: '#ffa726', motive: 'list' },",
  "  { name: 'response', type: 'java', color: '#b0bec5', motive: 'plain' },",
  "  { name: 'runner', type: 'java', color: '#b0bec5', motive: 'plain' },",
  "  { name: 'service', type: 'java', color: '#29b6f6', motive: 'gear' },",
  "  { name: 'util', type: 'java', color: '#78909c', motive: 'arrow' },",
  "  { name: 'wrapper', type: 'java', color: '#b0bec5', motive: 'plain' },",
].join('\n');

const javaBlock = [
  '// Java 分层目录（参考 Atom Material Icons 截图配色，图形用库内齿轮/几何自绘）',
  'const JAVA_ITEMS = [',
  javaItems,
  '];',
  '',
].join('\n');

if (!s.includes('JAVA_ITEMS')) {
  s = s.replace('const items = [', javaBlock + 'const items = [');
}

const motives = [
  'const MOTIVES = {',
  "  plain: () => '',",
  '  at: () => \'<text x="10.5" y="13.1" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="7.2" font-weight="700" fill="#fff">@</text>\',',
  "  gear: (d) => '<g transform=\"translate(9.4 9) scale(0.24)\" fill=\"#fff\" opacity=\"0.92\"><path d=\"' + d + '\"/></g>',",
  "  document: () => '<g fill=\"none\" stroke=\"#fff\" stroke-width=\"1\" opacity=\"0.92\"><rect x=\"6.4\" y=\"5.8\" width=\"7.2\" height=\"7.6\" rx=\"0.8\"/><path d=\"M7.8 8.2h4.4M7.8 10h4.4M7.8 11.8h2.8\"/></g>',",
  "  list: () => '<g stroke=\"#fff\" stroke-width=\"1.1\" stroke-linecap=\"round\" opacity=\"0.92\"><path d=\"M6.4 7h7.2M6.4 9.2h7.2M6.4 11.4h4.8\"/></g>',",
  "  alert: () => '<g fill=\"none\" stroke=\"#fff\" stroke-width=\"1.1\" opacity=\"0.92\"><circle cx=\"10.5\" cy=\"10\" r=\"3.6\"/><path d=\"M10.5 7.9v2.6\"/><circle cx=\"10.5\" cy=\"12.1\" r=\"0.55\" fill=\"#fff\" stroke=\"none\"/></g>',",
  "  funnel: () => '<path fill=\"#fff\" opacity=\"0.92\" d=\"M6.2 6.2h8.4l-3.2 3.8v3.4l-2.2-1.1V10Z\"/>',",
  "  globe: () => '<g fill=\"none\" stroke=\"#fff\" stroke-width=\"1\" opacity=\"0.92\"><circle cx=\"10.5\" cy=\"10\" r=\"3.4\"/><path d=\"M7.1 10h6.8M10.5 6.6c1.7 1.9 1.7 4.9 0 6.8M10.5 6.6c-1.7 1.9-1.7 4.9 0 6.8\"/></g>',",
  "  bars: () => '<g fill=\"#fff\" opacity=\"0.92\"><rect x=\"6.6\" y=\"6.6\" width=\"1.2\" height=\"6.4\" rx=\"0.4\"/><rect x=\"9.9\" y=\"6.6\" width=\"1.2\" height=\"6.4\" rx=\"0.4\"/><rect x=\"13.2\" y=\"6.6\" width=\"1.2\" height=\"6.4\" rx=\"0.4\"/></g>',",
  "  table: () => '<g fill=\"none\" stroke=\"#fff\" stroke-width=\"1\" opacity=\"0.92\"><rect x=\"6\" y=\"6\" width=\"8\" height=\"7.2\" rx=\"0.6\"/><path d=\"M6 8.4h8M6 10.8h8M9.3 6v7.2\"/></g>',",
  "  arrow: () => '<g fill=\"none\" stroke=\"#fff\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" opacity=\"0.92\"><path d=\"M6 8h7M10.8 6.4 13 8l-2.2 1.6\"/></g>',",
  '};',
  '',
].join('\n');
if (!s.includes('const MOTIVES')) {
  s = s.replace('function folderBase(color)', motives + 'function folderBase(color)');
}

if (!s.includes('gearPath')) {
  s = s.replace('const manifest = [];', "const gearPath = [...fs.readFileSync(`${ICONS}/settings.svg`, 'utf8').matchAll(/<path[^>]*\\sd=\"([^\"]+)\"/g)].map((m) => m[1])[0];\n\nconst manifest = [];");
}

const branch = [
  "  } else if (item.type === 'java') {",
  "    const motive = (MOTIVES[item.motive] || MOTIVES.plain)(gearPath);",
  "    fs.writeFileSync(outPath, `<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\">${folderBase(item.color)}${motive}</svg>\\n`);",
  "  } else if (item.type === 'dolphin-folder') {",
].join('\n');
if (!s.includes("item.type === 'java'")) {
  s = s.replace("  } else if (item.type === 'dolphin-folder') {", branch);
}

fs.writeFileSync(p, s);
console.log('patched:', s.includes('JAVA_ITEMS'), s.includes('const MOTIVES'), s.includes("item.type === 'java'"));
