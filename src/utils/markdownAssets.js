/**
 * Markdown ???????
 *
 * ???????????????????????? object URL ?????
 */
import { invoke } from '@utils/tauriInvoke';

const EXTERNAL_SRC_RE = /^(?:https?:|\/\/|data:|blob:|tauri:|asset:|content:|#)/i;
const EXTERNAL_LINK_RE = /^(?:https?:|mailto:|tel:|sms:|data:|blob:|javascript:|tauri:|asset:)/i;
const SAFE_MARKDOWN_PROTOCOL_RE = /^(?:https?|ircs?|mailto|xmpp)$/i;
const DATA_IMAGE_URI_RE = /^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i;
const WINDOWS_DRIVE_PATH_RE = /^[A-Z]:[\\/]/i;
const SAFE_IMAGE_PROTOCOL_RE = /^(?:file|blob|asset|tauri|content):/i;
const LINE_HINT_RE = /(?:^|[\s([{\u3000])L\s*(\d+)(?:\s*[~\-]\s*(\d+))?/i;

export const ALLOWED_IMAGE_PROTOCOLS = ['http', 'https', 'data', 'file', 'blob', 'asset', 'tauri', 'content'];

/**
 * \u5224\u65ad\u5b57\u7b26\u4e32\u662f\u5426\u4e3a\u53d7\u652f\u6301\u7684\u56fe\u7247 data URI\uff08\u4f8b\u5982 `data:image/png;base64,...`\uff09\u3002
 */
export function isDataImageUri(value) {
  return typeof value === 'string' && DATA_IMAGE_URI_RE.test(value.trim());
}

/**
 * \u628a Windows \u76d8\u7b26\u7edd\u5bf9\u8def\u5f84\u8f6c\u6362\u6210 `file:///` URI\uff0c\u907f\u514d `rehype-sanitize` \u628a `C:` \u8bef\u5224\u4e3a\u672a\u77e5\u534f\u8bae\u5e76\u79fb\u9664 `src`\u3002
 */
function windowsPathToFileUrl(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  return `file:///${encodeURI(normalized).replace(/#/g, '%23').replace(/\?/g, '%3F')}`;
}

/**
 * \u5728 `rehype-sanitize` \u4e4b\u524d\u89c4\u6574 `<img>` \u7684\u672c\u5730\u7edd\u5bf9\u8def\u5f84\uff0c\u786e\u4fdd Windows \u76d8\u7b26\u8def\u5f84\u80fd\u5b89\u5168\u901a\u8fc7\u534f\u8bae\u767d\u540d\u5355\u68c0\u67e5\u3002
 */
export function rehypeNormalizeImageSrc() {
  return (tree) => {
    const visit = (node) => {
      if (!node) return;
      if (node.type === 'element' && node.tagName === 'img' && typeof node.properties?.src === 'string') {
        const trimmed = node.properties.src.trim();
        if (WINDOWS_DRIVE_PATH_RE.test(trimmed)) {
          node.properties.src = windowsPathToFileUrl(trimmed);
        }
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) visit(child);
      }
    };
    visit(tree);
  };
}

/**
 * \u4e0e react-markdown \u9ed8\u8ba4 `defaultUrlTransform` \u7b49\u4ef7\u7684\u57fa\u7840\u534f\u8bae\u68c0\u67e5\u3002
 */
function defaultSafeUrl(value) {
  const colon = value.indexOf(':');
  const questionMark = value.indexOf('?');
  const numberSign = value.indexOf('#');
  const slash = value.indexOf('/');
  if (
    colon === -1 ||
    (slash !== -1 && colon > slash) ||
    (questionMark !== -1 && colon > questionMark) ||
    (numberSign !== -1 && colon > numberSign) ||
    SAFE_MARKDOWN_PROTOCOL_RE.test(value.slice(0, colon))
  ) {
    return value;
  }
  return '';
}

/**
 * \u4e3a `react-markdown` \u63d0\u4f9b\u5b89\u5168\u7684 URL \u8fc7\u6ee4\u51fd\u6570\uff1a
 * \u5728\u4fdd\u7559\u9ed8\u8ba4\u94fe\u63a5\u5b89\u5168\u7b56\u7565\u7684\u540c\u65f6\uff0c\u5141\u8bb8 `<img src>` \u4f7f\u7528 Base64 `data:image/...` \u4e0e\u672c\u5730\u8d44\u6e90\u534f\u8bae\u3002
 */
export function markdownUrlTransform(url, key, node) {
  const raw = String(url || '');
  const trimmed = raw.trim();
  if (key === 'src' && node?.tagName === 'img') {
    if (isDataImageUri(trimmed)) return trimmed;
    if (SAFE_IMAGE_PROTOCOL_RE.test(trimmed) || WINDOWS_DRIVE_PATH_RE.test(trimmed)) return trimmed;
  }
  return defaultSafeUrl(raw);
}

const MIME_BY_EXT = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

/**
 * Markdown 资源解析工具。
 *
 * 把 Markdown 中的相对图片路径解析成可在 WebView 中访问的真实资源地址，
 * 并在需要时通过 Tauri 命令读取二进制内容、生成临时 object URL。
 */
function isExternalSrc(src) {
  return !src || EXTERNAL_SRC_RE.test(src);
}

/**
 * 判断是否已经是可直接访问的本地绝对路径。
 */
function isAbsolutePath(src) {
  return /^[A-Z]:[\\/]/i.test(src) || src.startsWith('/') || src.startsWith('\\\\');
}

/**
 * 把 `file://` URL 还原成平台本地路径，便于后续统一拼接。
 */
function fileUrlToPath(src) {
  if (!/^file:/i.test(src || '')) return src;
  try {
    const url = new URL(src);
    const pathname = decodeURIComponent(url.pathname || '');
    if (url.hostname) return `\\\\${url.hostname}${pathname.replace(/\//g, '\\')}`;
    if (/^\/[A-Z]:\//i.test(pathname)) return pathname.slice(1).replace(/\//g, '\\');
    return pathname;
  } catch (_) {
    return src.replace(/^file:\/\//i, '');
  }
}

/**
 * 取出路径的目录部分。
 */
function dirname(path) {
  if (!path || typeof path !== 'string') return '';
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx >= 0 ? path.slice(0, idx) : '';
}

/**
 * 以平台分隔符拼接本地路径并做归一化。
 */
function joinPath(base, child) {
  if (!base) return child;
  const sep = base.includes('\\') ? '\\' : '/';
  return normalizeLocalPath(`${base.replace(/[\\/]+$/, '')}${sep}${child.replace(/^[\\/]+/, '')}`, sep);
}

/**
 * 规整本地路径中的 `.`、`..` 与多余分隔符。
 */
function normalizeLocalPath(path, sep = path.includes('\\') ? '\\' : '/') {
  const drive = /^[A-Z]:/i.exec(path)?.[0] || '';
  const unc = path.startsWith('\\\\');
  const absolute = path.startsWith('/') || !!drive || unc;
  const rest = drive ? path.slice(drive.length) : path;
  const parts = rest.split(/[\\/]+/);
  const out = [];

  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (out.length > (unc ? 2 : 0) && out[out.length - 1] !== '..') out.pop();
      else if (!absolute) out.push(part);
      continue;
    }
    out.push(part);
  }

  if (drive) return `${drive}${sep}${out.join(sep)}`;
  if (unc) return `\\\\${out.join(sep)}`;
  return `${absolute ? sep : ''}${out.join(sep)}`;
}

/**
 * 根据文件扩展名推断图片 MIME。
 */
function mimeFromPath(path) {
  const clean = (path || '').split(/[?#]/)[0];
  const ext = clean.includes('.') ? clean.split('.').pop().toLowerCase() : '';
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

export function resolveMarkdownAssetPath(src, documentPath) {
  const normalizedSrc = fileUrlToPath(src);
  if (!normalizedSrc || isExternalSrc(normalizedSrc)) return normalizedSrc;
  let decodedSrc = normalizedSrc;
  try {
    if (!/^file:/i.test(src)) decodedSrc = decodeURI(normalizedSrc);
  } catch {
    /* 保留无法解码的原始相对路径 */
  }
  if (isAbsolutePath(decodedSrc)) return decodedSrc;
  if (!documentPath || documentPath.startsWith('content://') || /^[a-z][a-z\d+.-]*:\/\//i.test(documentPath)) return src;
  return joinPath(dirname(documentPath), decodedSrc);
}

/**
 * 结合当前文档路径解析 Markdown 链接目标。
 *
 * 返回值会明确区分“应继续按外链处理”还是“可在应用内按本地文件打开”。
 * 其中相对本地路径会按当前文档所在目录归一化，便于预览层直接复用
 * `openFileFromPath()` 打开到编辑器标签。
 */
export function resolveMarkdownLinkPath(href, documentPath) {
  const normalizedHref = fileUrlToPath((href || '').trim());
  if (!normalizedHref) {
    return { path: '', internal: false, hash: '' };
  }
  if (normalizedHref.startsWith('#')) {
    return { path: '', internal: false, hash: normalizedHref.slice(1) };
  }
  if (EXTERNAL_LINK_RE.test(normalizedHref)) {
    return { path: normalizedHref, internal: false, hash: '' };
  }

  const [pathWithQuery = '', hash = ''] = normalizedHref.split('#', 2);
  const [pathPart = ''] = pathWithQuery.split('?', 1);
  let decodedPath;
  try { decodedPath = decodeURIComponent(pathPart); } catch { decodedPath = pathPart; }
  if (!decodedPath) {
    return { path: '', internal: false, hash };
  }
  if (decodedPath.startsWith('content://') || /^[a-z][a-z\d+.-]*:\/\//i.test(decodedPath) || isAbsolutePath(decodedPath)) {
    return { path: decodedPath, internal: true, hash };
  }
  if (!documentPath || documentPath.startsWith('content://') || /^[a-z][a-z\d+.-]*:\/\//i.test(documentPath)) {
    return { path: normalizedHref, internal: false, hash };
  }
  return {
    path: joinPath(dirname(documentPath), decodedPath),
    internal: true,
    hash,
  };
}

/**
 * 从链接文案、图片 alt 或其他辅助文本中提取行号提示。
 *
 * 支持 `L12`、`L12-20`、`L12~20` 等形式；当前跳转逻辑会优先使用起始行。
 */
export function parseMarkdownLineHint(value) {
  const match = String(value || '').match(LINE_HINT_RE);
  if (!match) return null;
  const line = Number(match[1] || 0);
  const endLine = Number(match[2] || 0);
  if (!Number.isFinite(line) || line <= 0) return null;
  return {
    line,
    endLine: Number.isFinite(endLine) && endLine > 0 ? endLine : line,
  };
}

/**
 * 把 base64 字符串转换成可生成 Blob 的二进制数组。
 */
function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * 加载 Markdown 图片真实显示地址。
 *
 * 本地资源会被读取成 Blob 并生成 object URL；外部资源则直接原样透传。
 */
export async function loadMarkdownImageSrc(src, documentPath) {
  const target = resolveMarkdownAssetPath(src, documentPath);
  if (!target || isExternalSrc(target)) return { src: target, objectUrl: null };

  try {
    const result = await invoke('read_binary_file', { path: target });
    const bytes = base64ToBytes(result.content_base64 || '');
    const blob = new Blob([bytes], { type: result.mime_type || mimeFromPath(target) });
    const objectUrl = URL.createObjectURL(blob);
    return { src: objectUrl, objectUrl };
  } catch (_) {
    return { src: target, objectUrl: null };
  }
}

/**
 * 扫描容器内图片并异步水合真实可显示地址。
 *
 * 通过 `data-moki-*` 属性记录原始 src 与已生成的 object URL，既能避免重复
 * 解析，也能在组件卸载时统一释放浏览器资源。
 */
export function hydrateMarkdownImages(container, documentPath) {
  if (!container) return () => {};
  const objectUrls = [];
  let cancelled = false;

  container.querySelectorAll('img[src]').forEach((img) => {
    const currentSrc = img.getAttribute('src');
    // ProseMirror may reuse the same img after an address edit. A changed src is
    // a new source, unless it is the object URL produced by this hydrator.
    const rawSrc = currentSrc !== img.dataset.mokiObjectUrl && currentSrc !== img.dataset.mokiResolvedSrc
      ? currentSrc : img.dataset.mokiOriginalSrc || currentSrc;
    // 使用原始 src 作为去重键，避免同一张图反复创建 object URL。
    if (!rawSrc || img.dataset.mokiResolvedSrc === rawSrc) return;
    img.dataset.mokiOriginalSrc = rawSrc;
    img.dataset.mokiResolvedSrc = rawSrc;

    loadMarkdownImageSrc(rawSrc, documentPath).then(({ src, objectUrl }) => {
      if (cancelled || !src || img.dataset.mokiResolvedSrc !== rawSrc || !img.isConnected) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        return;
      }
      if (img.dataset.mokiObjectUrl) URL.revokeObjectURL(img.dataset.mokiObjectUrl);
      if (objectUrl) objectUrls.push(objectUrl);
      img.src = src;
      if (objectUrl) img.dataset.mokiObjectUrl = objectUrl;
    });
  });

  return () => {
    cancelled = true;
    objectUrls.forEach((url) => {
      URL.revokeObjectURL(url);
      container.querySelectorAll(`img[data-moki-object-url="${url}"]`).forEach((img) => {
        delete img.dataset.mokiObjectUrl;
      });
    });
  };
}
