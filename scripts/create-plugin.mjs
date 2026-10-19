import { mkdir, writeFile, access } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(import.meta.dirname, '..');
export async function createPluginProject(directory, id = 'example.reading') {
  if (!/^[a-z0-9][a-z0-9.-]{2,80}$/.test(id)) throw new Error('Plugin id must use lowercase letters, numbers, dots and hyphens');
  const project = resolve(directory);
  try { await access(project); throw new Error('Target directory already exists; choose a new directory'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(join(project, 'src'), { recursive: true });
  const sdkPath = relative(project, join(root, 'plugins/sdk')).replaceAll('\\', '/');
  const toolsPath = relative(project, join(root, 'scripts')).replaceAll('\\', '/');
  await writeFile(join(project, 'manifest.json'), JSON.stringify({ id, name: '阅读助手', version: '1.0.0', entry: 'src/index.mjs', permissions: ['editor.read', 'editor.write', 'commands', 'ui.statusBar', 'styles.markdown'], fileExtensions: ['md', 'markdown'], styles: [{ id: 'reading', target: 'markdown', path: 'src/reading.css' }], configuration: { help: '示例阅读样式，修改后保存配置即可重新加载插件。', fields: [{ key: 'fontSize', label: '正文字号', type: 'number', min: 12, max: 28, default: 16 }] } }, null, 2) + '\n');
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: id, version: '1.0.0', private: true, type: 'module', scripts: { dev: 'node .moki.mjs dev', build: 'node .moki.mjs pack' }, devDependencies: { '@mokidown/sdk': 'file:' + sdkPath } }, null, 2) + '\n');
  await writeFile(join(project, '.moki.mjs'), `import { resolve } from 'node:path';\nimport { fileURLToPath, pathToFileURL } from 'node:url';\nconst action = process.argv[2];\nconst file = action === 'dev' ? 'plugin-dev.mjs' : 'package-plugin.mjs';\nconst target = process.env.MOKIDOWN_TOOLS ? pathToFileURL(resolve(process.env.MOKIDOWN_TOOLS, file)) : new URL(${JSON.stringify(toolsPath + '/')} + file, import.meta.url);\nprocess.argv = [process.execPath, fileURLToPath(target), '.', ...process.argv.slice(3)];\nawait import(target.href);\n`);
  await writeFile(join(project, 'src/index.mjs'), `import { definePlugin } from '@mokidown/sdk';\n\ndefinePlugin(async (sdk) => {\n  const config = await sdk.configuration.get();\n  await sdk.styles.setMarkdown('font-size', ':scope { font-size: ' + (config.fontSize || 16) + 'px; }');\n  const update = async () => {\n    const doc = await sdk.editor.getActiveDocument();\n    if (!doc) return sdk.statusBar.remove('reading.count');\n    const count = [...doc.content.replace(/\\s/g, '')].length;\n    await sdk.statusBar.set('reading.count', { documentId: doc.id, text: count + ' 字符', command: 'reading.quote' });\n  };\n  const unregister = await sdk.commands.register('reading.quote', '将选中文本设为引用', async () => {\n    const selection = await sdk.editor.getSelection();\n    if (!selection || !selection.text) return;\n    await sdk.editor.applyEdits(selection.documentId, selection.checksum, [{ from: selection.from, to: selection.to, text: selection.text.split('\\n').map(line => '> ' + line).join('\\n') }]);\n  });\n  sdk.onDispose(unregister);\n  sdk.onDispose(sdk.editor.onDidChangeDocuments(update));\n  sdk.onDispose(sdk.editor.onDidChangeContent(update));\n  await update();\n});\n`);
  await writeFile(join(project, 'src/reading.css'), ':scope { --reading-accent: #4091ff; }\nblockquote { border-left: 3px solid var(--reading-accent); border-radius: 6px; }\n');
  await writeFile(join(project, '.gitignore'), 'node_modules/\nreleases/\n');
  await writeFile(join(project, 'README.md'), '# 阅读助手\n\n`npm install` 安装本地 SDK 类型。`npm run dev` 启动本机开发服务，将地址填入 MokiDown → 语言服务 → 插件开发。保存源码后自动重载。\n\n`npm run build` 生成带校验和的独立插件包。移动项目后，可设置 MOKIDOWN_TOOLS 指向 MokiDown 的 scripts 目录。\n');
  return project;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage: npm run plugin:create -- <new-directory> [plugin-id]');
  console.log(await createPluginProject(process.argv[2], process.argv[3]));
}
