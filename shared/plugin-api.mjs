export const SDK_VERSION = '1.3.0';
// This inventory drives capability discovery and the generated API reference.
export const PLUGIN_CAPABILITIES = {
  'editor.documents': { permission: 'editor.read', title: '文档快照', description: '读取当前或指定已打开文档，获取未保存正文、语言及 SHA-256。' },
  'editor.selection': { permission: 'editor.read', title: '选区读取', description: '读取源码编辑器的 UTF-16 选区与选中文本。' },
  'editor.edit': { permission: 'editor.write', title: '文本编辑与定位', description: '通过校验和编辑正文、聚焦标签与设置选区，保留撤销历史。' },
  'editor.diff': { permission: 'editor.read', title: '差异与版本', description: '注入差异操作和历史列表，业务策略留在插件。' },
  'workspace.files': { permission: 'workspace.read', title: '授权目录', description: '列出和读取授权目录内声明的文件类型。' },
  'workspace.write': { permission: 'workspace.write', title: '文件写入', description: '通过预期校验和创建、更新或删除文件，拒绝覆盖未保存内容。' },
  'storage.manage': { permission: 'storage', title: '插件存储', description: '独立持久存储，支持读取、写入、列举及删除键。' },
  'network.request': { permission: 'network', title: '服务请求', description: '向配置的服务发送 JSON 请求，密钥由宿主附加。' },
  'commands.register': { permission: 'commands', title: '命令', description: '注册异步命令并返回操作结果，卸载时清理。' },
  'ui.status': { permission: 'ui.statusBar', title: '状态与任务', description: '注入文档状态、菜单动作和任务进度。' },
  'ui.files': { permission: 'ui.fileIcons', title: '文件图标与标记', description: '按扩展名或路径注入 SVG 图标和状态标记。' },
  'ui.notifications': { permission: 'ui.notifications', title: '编辑器通知', description: '发送使用编辑器主题的限时通知。' },
  'styles.markdown': { permission: 'styles.markdown', title: 'Markdown 样式', description: '注入限定到 Markdown 内容区域的样式，卸载即撤销。' },
  'host.theme': { title: '主题与生命周期', description: '查询深浅主题、监听切换，通过 AbortSignal 与清理回调释放资源。' },
  'configuration.read': { title: '插件配置', description: '读取已声明的非密钥配置；不返回访问密钥和目录绝对路径。' },
};

export function pluginCapabilities(permissions = []) {
  return Object.entries(PLUGIN_CAPABILITIES).filter(([, entry]) => !entry.permission || permissions.includes(entry.permission)).map(([name]) => name);
}

export function publicPluginConfiguration(pkg, settings = {}) {
  return Object.fromEntries((pkg.configuration?.fields || [])
    .filter((field) => !['secret', 'directory'].includes(field.type) && !/credential|password|secret|token/i.test(field.key))
    .map((field) => [field.key, settings[field.key] ?? field.default ?? null]));
}
