# MokiDown 插件 SDK 1.3（API 1）

完整网页文档：官网 `/docs/plugins/`；编辑器「语言服务 → 插件开发 → 插件开发文档」可离线打开。执行 `npm run plugin:docs` 从同一份能力清单生成网页，执行 `npm run plugin:docs:sync` 同步到同级 mde-server。

## 本机开发

```sh
npm run plugin:create -- ./my-plugins/reading example.reading
npm run plugin:dev -- ./my-plugins/reading
```

在语言服务的「插件开发」中连接终端地址，保存源码即可重载。开发连接只允许本机 HTTP，不保存为自动恢复的会话；构建失败保留旧版本，新增权限要求断开重连，停止后不接收迟到的更新。生成项目内可 `npm install` 安装 SDK 类型，使用 `npm run dev` / `npm run build` 调用源码工具；移动项目后设置 `MOKIDOWN_TOOLS`。

SDK 是按能力检测的增量 API，`sdk.capabilities.get()` / `has(name)` 与 `context().sdkVersion` 用于兼容判断。旧宿主没有 capabilities 时返回空数组。

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
| `statusBar.set(id,{documentId,text,title,command,args,icon,tone,busy})` / `remove(id)` | ui.statusBar | tone: info/success/warning/error；text ≤80 字符，title ≤120 字符 |
| `fileIcons.set(id,{extensions,paths,svg})` / `remove(id)` | ui.fileIcons | SVG ≤4096 字符；插件卸载时撤销贡献 |
| `onDispose(callback)` / `signal` | 无 | 清理回调 / AbortSignal；插件应自行释放定时器和资源 |

文件操作须声明 fileExtensions，例如 `["md","markdown","txt"]`。禁止绝对路径、`..`、符号链接逃逸。文件最大 32 MiB，HTTP 请求/响应最大 4 MiB，超时 30 秒；SDK RPC 默认超时 35 秒。富文本模式支持样式注入，文本编辑 API 当前要求源码编辑器。

## 文档状态和对比操作

插件运行在隐藏容器中，状态和操作注入编辑器，不创建独立页面。通过 editor.listDocuments() 获取已打开文档的 id、path、relativePath、active。relativePath 仅在文档位于授权目录内时存在；editor.onDidChangeDocuments() 在标签打开、关闭、切换时通知。

statusBar.set(id,{documentId,text,title,command,args,tone,busy,icon}) 可绑定一个文档。编辑器仅在对应标签激活时显示该状态，切换到没有对应状态的文件时不显示。短于 180ms 的忙碌状态会合并；已显示的加载状态至少保留 450ms，避免闪动。

editor.showDiff({path,content,label,actions}) 在编辑区显示通用可编辑对比。actions 按数组顺序展示，标题、命令和参数完全由插件声明。每个动作格式为 {id,title,command,args}。用户点击动作时，编辑器保存尚未落盘的当前正文，然后把 document:{id,path,content,checksum}、draftContent（右侧编辑稿）和 referenceContent（左侧参考稿）交给该插件命令。

命令必须返回 Promise：只有成功回执才关闭对比；失败展示错误并保留界面。编辑器不会解释动作名称或执行业务策略。插件自行提交业务请求，并可调用 editor.reloadDocument(id) 将授权目录中的最新磁盘内容加载到干净文档；存在未保存改动时拒绝覆盖。关闭对比只关闭界面，不代表完成插件操作。

```js
await sdk.commands.register('example.apply', '应用编辑结果', async (args) => {
  await applyDomainChange(args.document.checksum, args.draftContent);
  await sdk.editor.reloadDocument(args.document.id);
  return { complete: true };
});
await sdk.editor.showDiff({
  path: '/workspace/note.md', content: referenceText, label: '文档对比',
  actions: [{id:'apply.edits',title:'应用修改',command:'example.apply',args:{revision:42}}],
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

`npm run plugin:pack -- <directory> [output-directory]` 打包独立插件。官方服务端与业务插件位于独立仓库，主项目只保留通用宿主、SDK、开发工具与资源描述。不要将服务端或同步策略导回编辑器。

## SDK 1.3 新能力

| 接口 | 权限与约束 |
| --- | --- |
| `editor.getDocument(id)` | editor.read，读取指定已打开标签的最新缓冲区 |
| `editor.getSelection(id?)` | editor.read，源码模式，返回 UTF-16 范围、text 和 checksum |
| `editor.setSelection(id,checksum,from,to?)` | editor.write，校验正文未变化并定位源码 |
| `editor.focusDocument(id)` | editor.write，仅聚焦已打开标签 |
| `editor.onDidChangeContent(cb)` | editor.read，输入暂停 120ms 后返回 `{documentIds}` |
| `theme.get()` / `onDidChange(cb)` | 无，返回 light/dark；卸载时撤销监听 |
| `configuration.get()` | 无，只返回已声明的非密钥、非目录配置与默认值 |
| `notifications.show(message,{tone,duration})` | ui.notifications，每 10 秒最多 8 条，展示 1.5–10 秒 |
| `storage.keys()` / `delete(key)` | storage，删除会持久化 |
| `fileBadges.set(id,decoration)` / `remove(id)` | ui.fileIcons，与文件图标相同；无直接 DOM 访问 |
| `tasks.set(id,task)` / `remove(id)` | ui.statusBar，任务可带 progress、command、reveal |
| `versions.set(source)` / `remove(path)` | editor.read，版本源使用宿主侧边栏 |
| `versions.onDidSelect(cb)` / `onDidRequestRefresh(cb)` | editor.read，选择、刷新回调交给插件 |

配置新增 text、boolean、number、select 表单类型，仍支持 endpoint 的 url、credential 的 secret、workspace 的 directory。最多 32 个字段，键不得重复；select 使用 `{label,value}[]`，number 可声明 min/max，非密钥字段可声明 default。保存配置会重启运行环境。

激活失败、脚本未捕获异常或 12 秒未握手，宿主显示错误并停止运行环境。命令失败仍通过 Promise 回执交给当前编辑器界面。所有 SDK 事件都返回取消订阅函数；`onDispose` 以逆序清理，之后 RPC 返回 PLUGIN_STOPPED。
