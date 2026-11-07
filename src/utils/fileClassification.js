/**
 * @file 文件可打开性判定：内容嗅探 + 文件属性，不依赖扩展名。
 *
 * 用于轻量预检；实际打开由底层受限读取完整验证，不能只信任采样或缓存。
 */
import { checkFileTextHead, getFileInfo, readFileHead } from '@utils/tauriApi';
import { decodeTextBytes, HEAD_BYTES, MAX_TEXT_BYTES } from './textFilePolicy';
export { HEAD_BYTES, MAX_TEXT_BYTES } from './textFilePolicy';

const CACHE_LIMIT = 2048;

const cache = new Map();

/** 清空分类缓存（例如文件保存后 size/mtime 变化时由 key 自然失效）。 */
export function clearClassificationCache() {
  cache.clear();
}

/**
 * 仅根据头部字节判断是文本还是二进制。
 * @param {Uint8Array|number[]|null} bytes 文件头部字节。
 * @returns {'text'|'binary'|'invalid-encoding'|'unreadable'} 判定结果。
 */
export function sniffTextHead(bytes, { partial = true } = {}) {
  try { decodeTextBytes(bytes, { partial }); return 'text'; }
  catch (error) { return error.kind || 'unreadable'; }
}

/**
 * 判定文件能否按文本打开。
 * @param {string} path 文件路径。
 * @param {{ maxBytes?: number }} [options] 覆盖默认大小上限。
 * @returns {Promise<{ kind: string, info: object|null, cached?: boolean }>}
 */
export async function classifyFile(path, { maxBytes = MAX_TEXT_BYTES } = {}) {
  let info = null;
  try {
    info = await getFileInfo(path);
  } catch {
    return { kind: 'unreadable', info: null };
  }
  if (!info || info.is_file !== true) return { kind: 'not-file', info };
  if (info.size === 0) return { kind: 'text', info };
  if (info.size > maxBytes) return { kind: 'too-large', info };

  const modified = info.modified_ms ?? info.modifiedMs ?? info.modified;
  const key = `${path}|${info.size}|${modified ?? 0}`;
  const hit = cache.get(key);
  if (modified && hit) return { ...hit, cached: true };

  let kind;
  try {
    if (globalThis.window?.__TAURI_INTERNALS__ && !/^(?:web|content):/i.test(path)) {
      await checkFileTextHead(path);
      kind = 'text';
    } else {
      const head = await readFileHead(path, HEAD_BYTES);
      kind = head?.length ? sniffTextHead(head, { partial: info.size > head.length }) : 'unreadable';
    }
  } catch (error) { kind = error?.kind || 'unreadable'; }
  const result = { kind, info };
  if (modified && result.kind !== 'unreadable') cache.set(key, result);
  if (cache.size > CACHE_LIMIT) cache.clear();
  return result;
}
