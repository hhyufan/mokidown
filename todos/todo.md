**fix**

* [x] fix(editor): Monaco 重开文档后重做报 "Model is disposed!"。
* [x] fix(editor): 公式行输入 `$$` 后按空格崩溃。
* [x] fix(editor): 公式编辑连续撤销时光标位置越界。
* [x] fix(editor): Live Preview 光标无法进入被装饰的 Markdown 标记，行首左移会跳到上一行。
* [x] fix(editor): 行内代码右边界处光标无法退出到反引号外。
* [x] fix(files): GB18030 文本提示「文本编码无法识别」，无法打开。
* [x] fix(files): 保存 UTF-8 BOM 文件后 BOM 丢失。
* [x] fix(clipboard): Windows 右键粘贴触发剪贴板授权询问。
* [ ] fix(editor): 所见即所得表格右侧插行 `+` 溢出被裁切。
* [ ] fix(markdown): 任务列表无法通过光标输入源码新建。
* [ ] fix(ui): 无标签页时仍显示标签栏新建 `+`。
* [ ] fix(ui): 外部修改冲突弹窗多处背景未透明，未跟随主题玻璃效果。
* [ ] fix(editor): 虚拟渲染的 Markdown 组件中插入光标呈半截且不闪烁。
* [ ] fix(files): 已打开文件偶发检测不到磁盘修改。
* [ ] fix(files): 冲突弹窗点击「恢复磁盘内容」后仍显示当前内容。

**feat**

* [x] feat(editor): 实现 LaTeX 公式编辑器（已委托 77）。
* [ ] feat(editor): HTML 代码块实时预览（分屏渲染、编辑热刷新、预览端口设置）。
* [ ] feat(editor): HTML 文件支持编辑 / 分屏预览 / 纯预览三模式。
* [ ] feat(editor): 源码模式控制台改为集成终端。
* [ ] feat(editor): 插件开发文档支持内置以 HTML 打开。
* [ ] feat(editor): Markdown 预览级文档差异对比组件。
* [ ] feat(git): Git 历史文档对比。
* [ ] feat(markdown): 任务列表多级嵌套与父任务级联汇总。
* [ ] feat(explorer): 文件与目录快速删除（项目树与文件列表）。
* [ ] feat(explorer): 文件路径与底栏面包屑右键菜单（打开资源管理器 / 复制路径）。
* [ ] feat(ui): 错误日志面板：统一收集 Tauri/React 警告与报错，可查看并导出，不再直接红屏崩溃。

**opt**

* [ ] opt(explorer): 前进/后退/上一级、项目上一级与打开选中的方向键快捷键。
* [ ] opt(explorer): 项目搜索上一处/下一处的方向键切换。
* [ ] opt(ui): Tooltip 顶层挂载与视口边缘翻转，避免被窗口截断。
* [ ] opt(ui): 所有 message 统一为同一右上角组件。
* [ ] opt(editor): 所见即所得代码块编辑光标改为 Monaco 同款蓝色。
* [ ] opt(editor): 图像预览弹层限制在编辑区域内。
* [ ] opt(editor): Monaco 源码模式与 Milkdown 预览模式撤销/重做联动。
* [ ] opt(editor): 公式编辑区缺少「公式」标识，外观与引用块相同难以区分。
* [ ] opt(markdown): 无序列表嵌套改用空心圆区分层级。
* [ ] opt(editor): 重做脚注引用动画。
* [ ] opt(files): 外部修改冲突提示过于频繁、打断编辑，参考开源编辑器改为低打扰策略（延迟提示、仅激活文件、合并通知）。

**style**

* [ ] style(editor): HTML 编辑器内嵌编辑框「完成」改为绿色线性 ✓。
* [ ] style(icon): 重画自定义文件夹的展开态 SVG。

**chore**

* [ ] chore(explorer): 移除「最近文件」统计展示。
