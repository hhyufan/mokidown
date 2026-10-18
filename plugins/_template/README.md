# 插件开发模板

复制此目录，修改 manifest.json 的 id/name/version，在 src/index.mjs 中通过 `@mokidown/sdk` 开发。entry 为入口路径；permissions 只声明需要的能力。模板演示读取活动文档、注册命令、显示状态栏项目。

在编辑器仓库根目录（或独立 SDK 开发包根目录）执行：

```sh
npm run plugin:pack -- plugins/_template releases/my-plugin
```

产物是带内容摘要的 `*.mokiplugin.json`。在「语言服务 → 插件详情 → 导入插件包」导入；插件默认关闭。源码依赖由 esbuild 合并，运行时无外部模块依赖。样式插件可参考 `plugins/examples/markdown-style`。

详细接口、权限、CSS 作用域、更新协议和生命周期见 [SDK 文档](../SDK.md)。每次发布递增 version，先上传不可覆盖的包，再更新对应清单。
