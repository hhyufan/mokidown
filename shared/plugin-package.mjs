export const PLUGIN_API_VERSION = 1;
export const PLUGIN_PERMISSIONS = ['workspace.read', 'workspace.write', 'storage', 'network', 'editor.read', 'editor.write', 'styles.markdown', 'commands', 'ui.statusBar', 'ui.fileIcons'];
export const PACKAGE_DIGEST_MODE = 'canonical-json-v1';

export function canonicalPackage(pkg) {
  const canonical = (value) => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
  };
  const { integrity: _integrity, ...content } = pkg;
  return canonical(content);
}

export async function sha256(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))).map((n) => n.toString(16).padStart(2, '0')).join('');
}

export function validatePluginPackage(pkg) {
  const modern = pkg?.format === 'mokidown-extension-v2';
  const script = modern ? pkg.assets?.script : pkg?.script;
  if ((!modern && pkg?.format !== 'mokidown-extension-v1')
    || !/^[a-z0-9][a-z0-9.-]{2,80}$/.test(pkg.id || '')
    || typeof pkg.name !== 'string' || !pkg.name.trim() || pkg.name.length > 120
    || !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(pkg.version || '') && modern
    || typeof pkg.version !== 'string'
    || typeof script !== 'string' || script.length > 1024 * 1024
    || !Array.isArray(pkg.fileExtensions) || pkg.fileExtensions.some((value) => !/^[a-z0-9]{1,16}$/.test(value))
    || !Array.isArray(pkg.permissions) || pkg.permissions.some((value) => !PLUGIN_PERMISSIONS.includes(value))
    || (modern && pkg.apiVersion !== PLUGIN_API_VERSION)) throw new Error('Invalid plugin package or unsupported API version');
  const styles = modern ? pkg.assets.styles || [] : [];
  if (!Array.isArray(styles) || styles.length > 16 || styles.some((style) => !/^[a-z0-9][a-z0-9.-]{0,79}$/.test(style.id || '') || style.target !== 'markdown' || typeof style.css !== 'string' || style.css.length > 128 * 1024)) throw new Error('Invalid bundled plugin styles');
  if (styles.length && !pkg.permissions.includes('styles.markdown')) throw new Error('Bundled styles require styles.markdown permission');
  return { ...pkg, script, bundledStyles: styles };
}

export async function verifyPluginPackage(text, descriptor = {}) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('PLUGIN_INVALID_PACKAGE: 插件资源不是有效 JSON，请重新构建或下载插件包。'); }
  const pkg = validatePluginPackage(raw);
  const modern = raw.format === 'mokidown-extension-v2';
  const digest = await sha256(modern ? canonicalPackage(raw) : text);
  if (modern && (raw.integrity?.mode !== PACKAGE_DIGEST_MODE || raw.integrity?.sha256 !== digest)) throw new Error('PLUGIN_INTEGRITY_FAILED: 插件包内部校验失败，未替换现有版本。');
  if (descriptor.sha256 && digest !== descriptor.sha256) throw new Error('PLUGIN_CHECKSUM_MISMATCH: 插件包与清单不匹配，可能存在旧缓存或资源未完整发布。现有版本保持不变。');
  if (descriptor.id && pkg.id !== descriptor.id) throw new Error('Plugin package identity mismatch');
  if (descriptor.version && pkg.version !== descriptor.version) throw new Error('Plugin package version mismatch');
  return { pkg, digest };
}
