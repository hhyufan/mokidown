# MokiDown 插件 SDK（API 1）

官方增量同步插件随应用内置，默认关闭。在「语言服务 → 服务插件」配置服务地址、访问密钥、授权目录后启用。无需登录或访问 GitHub。GitHub 用于分发独立插件包；第三方插件可从清单安装或导入本地包。

## 开发与打包

插件是独立源码目录，不导入主应用内部模块。运行时 JavaScript 在无网络权限的隔离 iframe 内执行，通过消息通道调用宿主；关闭后卸载 iframe、网络请求、编辑器贡献和样式。

```json
{
  "id": "example.reading",
  "name": "阅读助手",
  "version": "1.0.0",
  "entry": "src/index.mjs",
  "permissions": ["editor.read", "editor.write", "styles.markdown", "commands", "ui.statusBar"],
  "styles": [{ "id": "reading", "target": "markdown", "path": "reading.css" }]
}
```

从仓库根目录执行：

```sh
npm run plugin:pack -- ./my-plugin ./releases/my-plugin
```

打包器内置 `@mokidown/sdk` 别名，使用 esbuild 将本地模块和 npm 依赖合并成单文件 IIFE，不需要自行配置构建工具。独立项目使用的 npm 依赖先在该项目安装。纯样式插件省略 entry 即可，参见 [Markdown 样式示例](examples/markdown-style)。CSS 在 manifest.styles 中声明，不使用 JS import CSS。

```js
import { definePlugin } from '@mokidown/sdk';

definePlugin(async (sdk) => {
  await sdk.commands.register('reading.quote', '插入引用', async () => {
    const doc = await sdk.editor.getActiveDocument();
    if (!doc) return;
    await sdk.editor.applyEdits(doc.id, doc.checksum, [
      { from: 0, to: 0, text: '> 阅读笔记\n\n' },
    ]);
  });
  await sdk.styles.setMarkdown('headings', 'h1, h2 { color: #647eea; }');
  const timer = setInterval(() => {}, 10000);
  sdk.onDispose(() => clearInterval(timer));
});
```

## 可用接口与权限

| 接口 | 权限 | 返回值 / 约束 |
| --- | --- | --- |
| `context()` | 无 | endpoint、workspace 布尔值、workspaceId、apiVersion、permissions；不提供密钥 |
| `storage.get(key)` / `set(key,value)` | storage | 插件独立持久存储；key 1–80 个字母、数字、点、下划线或横线；值最大 16 MiB |
| `workspace.list(path='')` | workspace.read | `{name,directory}[]`；只访问授权目录 |
| `workspace.read(path)` | workspace.read | `{content,checksum}`，不存在时均为 null |
| `workspace.write(path,content,expectedHash=null)` / `delete(path,expectedHash)` | workspace.write | SHA-256 乐观锁；创建文件 expectedHash=null；拒绝覆盖未保存的编辑器内容 |
| `net.request('/path',{method:'GET',body})` | network | `{status,data}`；只访问用户配置的服务；宿主附加密钥；不跟随携带密钥的重定向 |
| `editor.getActiveDocument()` | editor.read | null 或 `{id,path,name,content,checksum,language}` |
| `editor.applyEdits(id,checksum,edits)` | editor.write | 源码编辑器操作，可撤销；UTF-16 偏移，from 包含、to 不包含；范围不重叠，最多 1000 项；校验失败需重新读取 |
| `editor.onDidSave(callback)` | 无 | 返回取消订阅函数；事件 `{path,name}` |
| `styles.setMarkdown(id,css)` / `remove(id)` | styles.markdown | 样式只作用于 Markdown 预览和富文本内容；单张样式最多 128 KiB |
| `commands.register(id,title,callback)` | commands | Promise 返回注销函数；状态栏项目可指定 command |
| `statusBar.set(id,{text,title,command,icon,tone,busy,actions})` / `remove(id)` | ui.statusBar | tone: info/success/warning/error；text ≤80 字符，title ≤120 字符 |
| `fileIcons.set(id,{extensions,paths,svg})` / `remove(id)` | ui.fileIcons | SVG ≤4096 字符；插件卸载时撤销贡献 |
| `onDispose(callback)` / `signal` | 无 | 清理回调 / AbortSignal；插件应自行释放定时器和资源 |

文件操作须声明 fileExtensions，例如 `["md","markdown","txt"]`。禁止绝对路径、`..`、符号链接逃逸。文件最大 32 MiB，HTTP 请求/响应最大 4 MiB，超时 30 秒；SDK RPC 默认超时 35 秒。富文本模式支持样式注入，文本编辑 API 当前要求源码编辑器。

## 编辑器内操作

插件没有独立页面和“打开插件”入口，iframe 仅作为隐藏的后台执行容器。状态、命令、文件图标和 Markdown 样式通过声明式 SDK 接入编辑器。不要向 iframe 的 document 渲染操作界面；它不会展示给用户。

状态栏可附带 actions，用户点击状态项时在编辑器原生菜单中执行。group 用于按文档分组，args 原样传给同一插件的命令回调；disabled 可在操作期间禁用。每项最多 256 个动作，参数总计不超过 128 KiB，标题最多 80 字符，分组名最多 240 字符。一次仅展示部分记录时，可注册翻页命令并更新同一状态项。

```js
await sdk.commands.register('example.resolve', '处理文档', async (args) => {
  // 使用 args.documentId / args.choice 执行插件操作，然后刷新状态。
});
await sdk.statusBar.set('example.state', {
  text: '待处理 1 项', tone: 'warning',
  actions: [
    { id: 'document.local', title: '保留本地', group: 'note.md', command: 'example.resolve', args: { documentId: 'note', choice: 'local' } },
    { id: 'document.remote', title: '采用远端', group: 'note.md', command: 'example.resolve', args: { documentId: 'note', choice: 'remote' } },
  ],
});
```

## Markdown 样式

选择器自动限定到 `.md-preview` 内容区域。`:root` / `:scope` 单独使用时指向 Markdown 容器，适合定义 CSS 变量。支持普通规则、@media、@supports；嵌套 CSS 应先展开。不支持外部 url、@import、@font-face、转义 token、fixed/sticky。样式不用于修改应用工具栏。禁用/卸载时全部撤销；不同插件的样式相互独立，后启用的规则遵循 CSS 层叠。

```css
:root { --reading-accent: #647eea; }
h1, h2 { color: var(--reading-accent); }
blockquote { border-left: 4px solid var(--reading-accent); }
```

## 包格式、更新与分发

v2 包使用 `apiVersion:1`、`assets.script`、`assets.styles`；包内包含 `integrity:{mode:"canonical-json-v1",sha256}`。校验对象为移除顶层 integrity 后，递归按键排序的紧凑 JSON，数组顺序保留，字符串内容保持原样。JSON 缩进和文件换行不会影响校验。SDK 打包器负责此过程，无需手算。

文件名包含 id、版本和内容摘要，发布后不得覆盖。清单条目包括 id/name/version/url/sha256/checksumMode。清单 sha256 是规范化内容摘要；发布目录 SHA256SUMS 则是文件原始字节摘要，用于手动校验。应先上传包，再更新清单。版本变化必须递增 version。安装前验证包内部摘要和清单摘要；失败保留原版本和配置。仍兼容 v1 包的原始字节校验，但建议升级 v2。

`npm run build:service-plugins` 生成官方包、GitHub 清单、服务端 Linux 部署归档和 SHA256SUMS。工作流 `.github/workflows/service-plugins.yml` 可手动触发或通过 service-plugins-v* 标签发布，官方清单位于 service-plugin-catalog release。
