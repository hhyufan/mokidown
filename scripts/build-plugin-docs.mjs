import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SDK_VERSION, PLUGIN_CAPABILITIES } from '../shared/plugin-api.mjs';
const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'docs/plugin-development');
const out = resolve(root, 'public/docs/plugins');
const escape = text => String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const methods = {
  'editor.documents': ['editor.getActiveDocument()', 'editor.getDocument(documentId)', 'editor.listDocuments()', 'editor.onDidChangeDocuments(callback)', 'editor.onDidChangeContent(callback)', 'editor.onDidSave(callback)'],
  'editor.selection': ['editor.getSelection(documentId?)'],
  'editor.edit': ['editor.applyEdits(id, checksum, edits)', 'editor.setSelection(id, checksum, from, to?)', 'editor.focusDocument(id)', 'editor.reloadDocument(id) — also workspace.read'],
  'editor.diff': ['editor.showDiff(options)', 'editor.showVersions(options)', 'versions.set(source) / remove(path)', 'versions.onDidSelect(callback)', 'versions.onDidRequestRefresh(callback)'],
  'workspace.files': ['workspace.list(path?)', 'workspace.read(path)'],
  'workspace.write': ['workspace.write(path, content, expectedHash?)', 'workspace.delete(path, expectedHash)'],
  'storage.manage': ['storage.get(key) / set(key, value)', 'storage.keys() / delete(key)'],
  'network.request': ["net.request('/path', { method, body })"],
  'commands.register': ['commands.register(id, title, asyncCallback) → unsubscribe'],
  'ui.status': ['statusBar.set(id, item) / remove(id)', 'tasks.set(id, task) / remove(id)'],
  'ui.files': ['fileIcons.set(id, decoration) / remove(id)', 'fileBadges.set(id, decoration) / remove(id)'],
  'ui.notifications': ["notifications.show(message, { tone: 'success', duration: 4000 })"],
  'styles.markdown': ['styles.setMarkdown(id, css) / remove(id)'],
  'host.theme': ['context()', 'capabilities.get() / has(name)', 'theme.get() / onDidChange(callback)', 'onDispose(callback) / signal'],
  'configuration.read': ['configuration.get()'],
};
let html = await readFile(resolve(source, 'index.template.html'), 'utf8');
const navigation = [['开始构建',[['overview','概览'],['quickstart','快速开始'],['structure','项目结构'],['manifest','清单与配置']]],['开发参考',[['api','API 能力'],['editor','文档与选区'],['ui','编辑器注入'],['styles','Markdown 样式']]],['交付与维护',[['lifecycle','生命周期'],['distribution','打包与分发'],['troubleshooting','排查问题']]]];
html = html.replace('__NAVIGATION__', navigation.map(([label,links])=>`<div class="nav-group">${escape(label)}</div>${links.map(([id,title])=>`<a href="#${id}">${escape(title)}</a>`).join('')}`).join(''));
html = html.replace('__API_REFERENCE__', Object.entries(PLUGIN_CAPABILITIES).map(([id,entry])=>`<article class="api-card" data-capability="${id}"><div class="api-card-header"><h3>${escape(entry.title)}</h3><span class="permission">${escape(entry.permission || '无需额外权限')}</span></div><p>${escape(entry.description)}</p><div class="api-methods">${methods[id].map(method=>`<code>sdk.${escape(method)}</code>`).join('')}</div></article>`).join(''));
html = html.replaceAll('__SDK_VERSION__', SDK_VERSION);
await mkdir(out, { recursive: true });
await writeFile(resolve(out,'index.html'), html);
for(const file of ['plugin-docs.css','plugin-docs.js','brand.webp']) await copyFile(resolve(source,file),resolve(out,file));
for(const font of ['Poppins-Regular.woff2','Poppins-SemiBold.woff2','SourceHanSansSC-Regular.woff2','JetBrainsMono-VariableFont_wght.woff2']) await copyFile(resolve(root,'src/assets/font',font),resolve(out,font));
await copyFile(resolve(root,'plugins/sdk/index.d.ts'),resolve(out,'sdk.d.ts'));
console.log(`Plugin documentation generated: ${out} (SDK ${SDK_VERSION})`);
