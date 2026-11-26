import { parserCtx } from '@milkdown/kit/core';
import { DOMParser as PMDOMParser, Slice } from '@milkdown/kit/prose/model';
import { Plugin } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { completePastedInlinePair } from './milkdownLiveSyntax';

/**
 * 把制表符分隔的表格文本（Excel / 网页表格复制出的 text/plain）转成 GFM 表格。
 * 单列、行数不足时返回 null；行尾缺列会补空单元格，首行缺表头时左上角留空。
 */
export function tsvToMarkdownTable(text) {
  const lines = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => line.trim() !== '');
  if (lines.length < 2) return null;
  const rows = lines.map((line) => line.split('\t').map((cell) => cell.trim()));
  if (rows.some((row) => row.length < 2)) return null;
  const columns = Math.max(...rows.map((row) => row.length));
  const escape = (cell) => cell.replace(/\|/g, '\\|');
  // 首行少列通常是左上角表头缺失（例如从 Markdown 表格复制时丢了一列），
  // 补在开头让数据列与表头对齐；数据行少列则补在末尾。
  const padded = rows.map((row, index) => {
    const missing = columns - row.length;
    if (!missing) return row;
    const filler = Array.from({ length: missing }, () => '');
    return index === 0 ? [...filler, ...row] : [...row, ...filler];
  });
  const header = `| ${padded[0].map(escape).join(' | ')} |`;
  const separator = `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`;
  const body = padded.slice(1).map((row) => `| ${row.map(escape).join(' | ')} |`);
  return [header, separator, ...body].join('\n');
}

/**
 * 聊天/网页复制整段内容时，text/plain 是混合文本：标题、代码行和表格混在一起，
 * 表格块表现为连续的制表符行。把连续表格块转成 GFM 表格，其余行原样保留，
 * 这样即使剪贴板没有 text/html 也能保留表格结构。
 */
export function mixedTextToMarkdown(text) {
  const lines = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const out = [];
  let block = [];
  let changed = false;
  const flush = () => {
    if (block.length >= 2) {
      const table = tsvToMarkdownTable(block.join('\n'));
      if (table) {
        out.push(table);
        changed = true;
        block = [];
        return;
      }
    }
    out.push(...block);
    block = [];
  };
  for (const line of lines) {
    if (line.includes('\t') && line.trim() !== '') block.push(line);
    else {
      flush();
      out.push(line);
    }
  }
  flush();
  return changed ? out.join('\n') : null;
}

/** 纯文本里是否已经带 Markdown 结构（而不是渲染后的普通文本）。 */
export function looksLikeMarkdown(text) {
  return /^(?:#{1,6}\s|```)/m.test(text) || /\|.*\|/m.test(text) || /\*\*[^*\n]+\*\*/.test(text);
}

const RICH_HTML = /<(?:h[1-6]|table|thead|tbody|ul|ol|pre|blockquote|strong|em)\b/i;

/**
 * 解析 HTML 片段并插入。不能调用 view.pasteHTML：它会再次触发 handlePaste，
 * 在本插件里形成递归（Maximum call stack size exceeded）。
 */
function insertHtml(view, html) {
  const dom = new window.DOMParser().parseFromString(html, 'text/html');
  const slice = PMDOMParser.fromSchema(view.state.schema).parseSlice(dom.body, {
    preserveWhitespace: true,
  });
  if (!slice || slice.size === 0) return false;
  view.dispatch(
    view.state.tr
      .replaceSelection(slice)
      .scrollIntoView()
      .setMeta('paste', true)
      .setMeta('uiEvent', 'paste'),
  );
  return true;
}

function insertMarkdown(view, ctx, markdown) {
  const doc = ctx.get(parserCtx)(String(markdown).replace(/\r\n?/g, '\n'));
  if (!doc) return false;
  view.dispatch(
    view.state.tr
      .replaceSelection(Slice.maxOpen(doc.content))
      .scrollIntoView()
      .setMeta('paste', true)
      .setMeta('uiEvent', 'paste'),
  );
  return true;
}

/** 读取图片文件为 data URL。 */
function readImageAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** 从 MIME 推断图片扩展名。 */
function imageExtension(type) {
  const subtype = String(type || '').split('/')[1] || 'png';
  if (subtype === 'svg+xml') return 'svg';
  if (subtype === 'jpeg') return 'jpg';
  return subtype.replace(/[^a-z0-9]/gi, '') || 'png';
}

/** 把粘贴的图片写入默认目录，或退回 Base64 内嵌。 */
async function resolvePastedImageSrc(file, index) {
  const dataUrl = await readImageAsDataUrl(file);
  const [{ default: useConfigStore }, { writeBinaryFile }, { getImageHostRule }] =
    await Promise.all([
      import('@store/useConfigStore'),
      import('@utils/tauriApi'),
      import('@/services/settingsDocuments'),
    ]);
  const { imageDefaultDir = '' } = useConfigStore.getState();
  const base64 = dataUrl.split(',')[1] || '';
  const name = `image-${Date.now()}-${index}.${imageExtension(file.type)}`;
  const dir = String(imageDefaultDir).trim();
  const isEndpoint = /^https?:\/\//i.test(dir) || /:[0-9]+(?:\/|$)/.test(dir);
  const rule = getImageHostRule();
  if (rule) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const uploaded = await invoke('upload_image', {
        rule,
        filename: name,
        mime: file.type || 'image/png',
        contentBase64: base64,
      });
      if (uploaded) return uploaded;
    } catch (error) {
      console.warn('[paste] Image host upload failed, falling back:', error);
    }
  }
  if (!dir || isEndpoint || !base64) return dataUrl;
  const target = `${dir.replace(/[\\/]+$/, '')}/${name}`;
  await writeBinaryFile(target, base64);
  return target.replaceAll('\\', '/');
}

/**
 * 按需给 Markdown 链接目标加尖括号：含空格、括号或反斜杠时才需要。
 *
 * @param {string} src 图片地址。
 * @returns {string} 可直接放进 Markdown 图片语法的目标。
 */
export function markdownImageDestination(src) {
  const value = String(src || '');
  return /[\s()\\<>]/.test(value) ? `<${value}>` : value;
}

/**
 * 保存/上传粘贴图片，并返回图片地址与用于 alt 的文件名。
 *
 * @param {File} file 图片文件。
 * @param {number} index 同一批图片中的序号。
 * @returns {Promise<{src: string, name: string}>} 图片地址与文件名。
 */
export async function resolvePastedImage(file, index = 0) {
  const src = await resolvePastedImageSrc(file, index);
  const fallback = file.name || `image-${Date.now()}-${index}.${imageExtension(file.type)}`;
  let name = fallback;
  if (/^https?:\/\//i.test(src)) {
    const segment = src.split('/').pop()?.split('?')[0] || '';
    try {
      name = decodeURIComponent(segment) || fallback;
    } catch {
      name = segment || fallback;
    }
  } else if (src && !src.startsWith('data:')) {
    name = src.split(/[\\/]/).pop() || fallback;
  }
  return { src, name };
}

async function insertPastedImages(view, ctx, files) {
  const markdown = [];
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    try {
      const { src, name } = await resolvePastedImage(file, index);
      if (src) markdown.push(`![${name}](${markdownImageDestination(src)})`);
    } catch (error) {
      console.warn('[paste] Failed to store pasted image:', error);
    }
  }
  if (markdown.length) insertMarkdown(view, ctx, markdown.join('\n\n'));
}

// Source copied from a code editor often includes highlighted HTML. Prefer
// Markdown in that case; rendered rich text (chat/markdown previews) is parsed
// from HTML so headings, tables and code blocks keep their structure.
export const createMarkdownPastePlugin = (ctx) =>
  new Plugin({
    props: {
      handlePaste(view, event) {
        if (!view.editable || view.state.selection.$from.parent.type.spec.code) return false;
        const data = event.clipboardData;
        const imageFiles = Array.from(data?.files || []).filter((file) =>
          file.type.startsWith('image/'),
        );
        if (imageFiles.length) {
          event.preventDefault();
          void insertPastedImages(view, ctx, imageFiles);
          return true;
        }
        const text = data?.getData('text/plain');
        if (!text) return false;
        const html = data.getData('text/html') || '';
        // 普通文本粘贴也要完成空标记对；富文本和 Markdown 结构保留原解析路径。
        if (
          !looksLikeMarkdown(text) &&
          !RICH_HTML.test(html) &&
          completePastedInlinePair(view, text)
        )
          return true;
        // 表格软件/网页表格复制出的纯文本是 TSV，优先转成 GFM 表格。
        const table = tsvToMarkdownTable(text);
        if (table && insertMarkdown(view, ctx, table)) return true;
        let mode;
        try {
          mode = JSON.parse(data.getData('vscode-editor-data') || '{}').mode;
        } catch {
          /* Optional source metadata. */
        }
        // 非 Markdown 来源（如 VS Code 的 plaintext）也可能复制出 **...** 文本，
        // 只要文本本身带 Markdown 结构就继续解析，不能直接放弃。
        if (mode && mode !== 'markdown' && !looksLikeMarkdown(text)) return false;
        if (mode === 'markdown' || looksLikeMarkdown(text)) {
          return insertMarkdown(view, ctx, text);
        }
        // 渲染后的富文本（DeepSeek/网页复制）：text/plain 已失去语法，改用 HTML 解析，
        // 保留标题、表格、列表和代码块。
        if (RICH_HTML.test(html) && !/data-pm-slice\s*=/i.test(html) && insertHtml(view, html))
          return true;
        // 没有可用的 HTML 时，退回混合文本处理：连续制表符行转表格，其余保留。
        const mixed = mixedTextToMarkdown(text);
        if (mixed) return insertMarkdown(view, ctx, mixed);
        return false;
      },
    },
  });

export const milkdownMarkdownPaste = $prose(createMarkdownPastePlugin);
