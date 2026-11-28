* [x] **修复（fix）37/43**

  * [x] fix(editor): Monaco 重开文档后重做报 "Model is disposed!"。

  * [x] fix(editor): 公式行输入`$$`后按空格崩溃。

  * [x] fix(editor): 公式编辑连续撤销时光标位置越界。

  * [x] fix(editor): Live Preview 光标无法进入被装饰的 Markdown 标记，行首左移会跳到上一行。

  * [x] fix(editor): 行内代码右边界处光标无法退出到反引号外。

  * [x] fix(files): 保存 UTF-8 BOM 文件后 BOM 丢失。

  * [x] fix(clipboard): Windows 右键粘贴触发剪贴板授权询问。

  * [x] fix(editor): 所见即所得表格右侧插行 `+` 溢出被裁切。

  * [x] fix(markdown): 任务列表无法通过光标输入源码新建。

  * [x] fix(ui): 无标签页时仍显示标签栏新建 `+`。

  * [x] fix(ui): 外部修改冲突弹窗多处背景未透明，未跟随主题玻璃效果。

  * [x] fix(editor): 虚拟渲染的 Markdown 组件中插入光标呈半截且不闪烁。

  * [x] fix(files): 已打开文件偶发检测不到磁盘修改。

  * [x] fix(files): 冲突弹窗点击「恢复磁盘内容」后仍显示当前内容。

  * [x] fix(editor): 粘贴内容到 `**|**` 空粗体对中间后不渲染粗体，刷新页面才正确。

  * [x] fix(editor): 无序列表空项后面还有续段或子列表时，Backspace/Delete 无法删除。

  * [x] fix(android): Android 安装包缺少前端 assets，启动一直停在启动图。

  * [x] fix(ui): 窗口全屏时仍可被拖动、标题栏「还原」无法退出全屏。

  * [x] fix(footer): 底部面包屑在窄窗口溢出时左侧盘符被裁掉。

  * [x] fix(tabbar): 窄屏标签底部圆角被裁、与编辑器之间出现间距。

  * [x] fix(windows): 调整窗口尺寸时 WebView 停在旧尺寸，出现白边与裁切。

  * [x] fix(editor): 退出/进入分屏时预览重新挂载、调整尺寸时重新渲染闪动。

  * [x] fix(windows): WebView2 默认右键菜单、开发者工具与浏览器快捷键干扰应用。

  * [x] fix(app): Tauri 事件监听未清理导致重复订阅，错误通知在渲染期间触发警告。

  * [x] fix(ui): 拖拽同名冲突弹窗重命名后文件图标不同步。

  * [x] fix(markdown): 任务列表层级分支线在子列表交界处被截断，父级竖线不连续。

  * [x] fix(markdown): 子级展开/折叠箭头未居中父级竖线，横向分支线紧贴任务项；改为左移居中并留出间距。

  * [x] fix(history): 取消 Monaco / Markdown 对比编辑器的加载中间态，未就绪前不渲染对比视图。

  * [x] fix(ui): 修复 Tooltip 与变动下拉列表打开首帧的背景图错位（需等待一帧布局）。

  * [x] fix(markdown): Base64 图片应在 Monaco 中折叠。

  * [x] fix(markdown): 任务列表输入完成后出现异常中间态（见截图）。

  * [x] fix(editor): 取消 Milkdown 删除图片时删除末尾 `]` 并显示原语法的逻辑。

  * [x] fix(editor): Monaco 折行编辑时出现错位重叠（见截图）。

  * [x] fix(markdown): 任务列表下方同级内容（代码块等）左边缘与任务正文对齐，但任务列表本体和勾选框不能位移。

  * [x] fix(ui): Monaco 工具栏与 LSP 语言服务弹层的 hover 背景不透明。

  * [x] fix(i18n): Monaco 工具栏汉化方案在 build 后失效，寻找更有效的实现。

  * [x] fix(history): Markdown 同块对比的撤销行箭头挤在顶部，未与具体行对应（见截图）。

  * [x] fix(milkdown): 编辑过程中保持滚动位置稳定，仅在粘贴或大组件（图片、HTML、代码块、新建表格等）渲染导致内容增高时允许必要的下移。

  * [x] fix(milkdown): 无序列表后的同级空行存在交互不一致：方向键可进入，鼠标点击无法落位；需统一空段落/间隙光标的点击与键盘行为。

  * [x] fix(milkdown): 代码块语言下拉按 Enter 应用时，Enter 同时触发代码块换行，导致代码块多出空行、光标落到第二行。

  * [x] fix(monaco): 菜单粘贴时 WebView 会弹出剪贴板读取授权提示（文本/图像），终端粘贴偶发同样情况；应避免触发该提示。

  * [x] fix(history): 已打开的对比标签页不会随本地文件的最新修改更新右侧内容；应在文件变更后自动刷新对应的对比。

  * [x] fix(ui): 设置页与侧栏的顶部行高不一致，导致两侧水平分隔线错位；需统一行高与基线。

  * [x] fix(sidebar): 文件列表 Tooltip 被侧边栏裁剪，需显示在侧边栏外侧。

  * [x] fix(footer): 底部面包屑随输入或底栏状态变化而位移，需保持位置固定。

  * [ ] bug1.任务列表和光标

  * [ ] bug2.底栏调节尺寸内容被截断明明左侧有位置

  * [ ] bug3.对比右侧的右键菜单

- [ ] **新功能（feat）25/29**

  * [x] feat(editor): 实现 LaTeX 公式编辑器（已委托 77）。

  * [x] feat(editor): HTML 代码块实时预览（分屏渲染、编辑热刷新、预览端口设置）。

  * [x] feat(editor): HTML 文件支持编辑 / 分屏预览 / 纯预览三模式。

  * [x] feat(editor): 源码模式控制台改为集成终端。

  * [x] feat(editor): 插件开发文档支持内置以 HTML 打开。

  * [x] feat(editor): Markdown 预览级文档差异对比组件。

  * [x] feat(git): Git 历史文档对比。

  * [x] feat(markdown): 任务列表多级嵌套与父任务级联汇总。

  * [x] feat(explorer): 文件与目录快速删除（项目树与文件列表）。

  * [x] feat(explorer): 文件路径与底栏面包屑右键菜单（打开资源管理器 / 复制路径）。

  * [x] feat(ui): 错误日志面板：统一收集 Tauri/React 警告与报错，可查看并导出，不再直接红屏崩溃。

  * [x] feat(reader): 独立阅读器窗口：只读 Markdown / 源码视图、缩放、置顶、主窗口与阅读器互转。

  * [x] feat(tabs): 标签拖拽分离到阅读器窗口。

  * [x] feat(editor): 粘贴 TSV / 混合文本中的表格自动转 GFM 表格（含缺表头列补齐）。

  * [x] feat(android): Android 一键构建脚本（注入 MSVC/NDK，解决 msvcrt.lib 缺失）。

  * [x] feat(files): 外部文件拖入主窗口、资源管理器与标签栏。

  * [x] feat(reader): 阅读器窗口接收外部拖入文件。

  * [x] feat(settings): 「拖出文件时」默认行为设置，随本地设置快照导入导出。

  * [x] feat(editor): Markdown 折叠抽屉动画（标题、任务列表、普通列表、代码块）。

  * [x] feat(tabbar): 标签关闭快捷键（关闭当前/其他/所有，可在设置 → 快捷键调整）。

  * [x] feat(editor): 任务列表勾选/半选改为旧图形倒放、新图形从左到右绘制；删除线左到右划出、取消右到左收回并穿过行内代码。

  * [x] feat(editor): 先输入文字再从两侧补 `**` 时立即渲染粗体，保留空白处智能配对。

  * [x] feat(settings): 增加默认图片目录设置（支持图床链接），设置后粘贴图片保存到该目录。

  * [x] feat(settings): 更新快捷键设置，覆盖项目所有可用快捷键。

  * [x] feat(editor): Milkdown 选中图片复制到系统剪贴板,考虑绝对相对本地路径和图床链接的，把图片下载之后传到剪切板。            （原生剪贴板方案未生效）。

  * [x] feat(editor): 增加代码 / Markdown 右键菜单截图，或选中文本 + 快捷键截图。

  * [x] feat(outline): 大纲重做。

  * [ ] feat(platform): 增加 macOS 与 Linux 支持。

  * [ ] feat(android): 重新适配 Android 平板端；手机端暂不支持，后续以独立小窗 UI 适配手机及横屏。

  * [x] feat(settings): 为设置导航增加随选中/悬停项平滑滑动的指示滑块动画。

- [x] **体验优化（opt）20/22**

  * [x] opt(explorer): 前进/后退/上一级、项目上一级与打开选中的方向键快捷键。

  * [x] opt(explorer): 项目搜索上一处/下一处的方向键切换。

  * [x] opt(ui): Tooltip 顶层挂载与视口边缘翻转，避免被窗口截断。

  * [x] opt(ui): 所有 message 统一为同一右上角组件。

  * [x] opt(editor): 所见即所得代码块编辑光标改为 Monaco 同款蓝色。

  * [x] opt(editor): 图像预览弹层限制在编辑区域内。

  * [x] opt(editor): Monaco 源码模式与 Milkdown 预览模式撤销/重做联动。

  * [x] opt(editor): 公式编辑区缺少「公式」标识，外观与引用块相同难以区分。

  * [x] opt(markdown): 无序列表嵌套改用空心圆区分层级。

  * [x] opt(editor): 重做脚注引用动画。

  * [x] opt(files): 外部修改冲突提示过于频繁、打断编辑，参考开源编辑器改为低打扰策略。

  * [x] opt(explorer): 项目树 / 文件树路径 tooltip 与最近文件一致，从侧栏右缘外侧弹出。

  * [x] opt(ui): 窗口拖动扩展到标题栏、侧栏、标签栏、底栏空白区域，全屏时禁止拖动。

  * [x] opt(tabbar): 标签右键菜单精简为关闭当前/其他/所有，宽度自适应并显示快捷键。

  * [x] opt(footer): 面包屑宽屏居中、窄屏溢出时从左侧显示，盘符不再被裁掉。

  * [x] opt(ui): 拖拽同名冲突弹窗精简：短文案、输入框限宽、左侧文件图标。

  * [x] opt(ui): 减少窗口缩放期间的重绘与布局抖动（壁纸图层、标题栏防抖、分屏几何合并）。

  * [x] opt(sidebar): 侧栏分栏动画与知识树状态缓存优化。

  * [x] opt(ui): 任务复选框改用下拉同款壁纸底与半透明选中态，勾号/横杠保持实色。

  * [x] opt(editor): 优化编辑器shadow          

  * [x] opt(editor): 优化 Monaco （常规/对比）与 Milkdown（常规/对比）的打开速度，参考业界方案权衡预加载、实例复用、缓存与渲染路径；避免灾难级预加载（如预载整个文件列表），且优化不得以破坏视觉完整性为代价（如折叠、高亮未就绪即渲染等等）。

  * [x] opt(website): 优化网站首屏加载速度，当前在浏览器中打开明显慢于 Edge 等主流浏览器，需定位并降低加载开销。

- [x] **样式（style）5/5**

  * [x] style(editor): HTML 编辑器内嵌编辑框「完成」改为绿色线性 ✓。

  * [x] style(icon): 重画自定义文件夹的展开态 SVG。

  * [x] style(ui): 弹窗头部改为浅色区分、底部与正文同色，并去掉多余分割线。

  * [x] style(ui): 文件拖入高亮改为淡色背景、去掉描边。

  * [x] style(ui): 小屏侧栏改用壁纸/玻璃背景并减薄遮罩。

- [x] **杂项（chore）1/1**

  * [x] chore(explorer): 移除「最近文件」统计展示。

- [ ] **难题（hard）0/1**

  * [ ] fix(webview): 修复窗口尺寸调整引起的编辑器闪动（2026/11/26，GPT 6.2 Astra High 亦无法解决）。


