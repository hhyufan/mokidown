import { parserCtx } from '@milkdown/kit/core';
import { Slice } from '@milkdown/kit/prose/model';
import { Plugin } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

/**
 * 把制表符分隔的表格文本（Excel / 网页表格复制出的 text/plain）转成 GFM 表格。
 * 单列、行数不足时返回 null；行尾缺列会补空单元格，首行缺表头时左上角留空。
 */
export function tsvToMarkdownTable(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').filter((line) => line.trim() !== '');
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
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
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
    else { flush(); out.push(line); }
  }
  flush();
  return changed ? out.join('\n') : null;
}

/** 纯文本里是否已经带 Markdown 结构（而不是渲染后的普通文本）。 */
export function looksLikeMarkdown(text) {
  return /^(?:#{1,6}\s|```)/m.test(text) || /\|.*\|/m.test(text) || /\*\*[^*\n]+\*\*/.test(text);
}

const RICH_HTML = /<(?:h[1-6]|table|thead|tbody|ul|ol|pre|blockquote|strong|em)\b/i;

function insertMarkdown(view, ctx, markdown) {
  const doc = ctx.get(parserCtx)(String(markdown).replace(/\r\n?/g, '\n'));
  if (!doc) return false;
  view.dispatch(view.state.tr.replaceSelection(Slice.maxOpen(doc.content)).scrollIntoView()
    .setMeta('paste', true).setMeta('uiEvent', 'paste'));
  return true;
}

// Source copied from a code editor often includes highlighted HTML. Prefer
// Markdown in that case; rendered rich text (chat/markdown previews) is parsed
// from HTML so headings, tables and code blocks keep their structure.
export const milkdownMarkdownPaste = $prose((ctx) => new Plugin({
  props: {
    handlePaste(view, event) {
      if (!view.editable || view.state.selection.$from.parent.type.spec.code) return false;
      const data = event.clipboardData;
      const text = data?.getData('text/plain');
      if (!text) return false;
      // 表格软件/网页表格复制出的纯文本是 TSV，优先转成 GFM 表格。
      const table = tsvToMarkdownTable(text);
      if (table && insertMarkdown(view, ctx, table)) return true;
      let mode;
      try { mode = JSON.parse(data.getData('vscode-editor-data') || '{}').mode; } catch { /* Optional source metadata. */ }
      if (mode && mode !== 'markdown') return false;
      const html = data.getData('text/html') || '';
      if (mode === 'markdown' || looksLikeMarkdown(text)) {
        return insertMarkdown(view, ctx, text);
      }
      // 渲染后的富文本（DeepSeek/网页复制）：text/plain 已失去语法，改用 HTML 解析，
      // 保留标题、表格、列表和代码块。
      if (RICH_HTML.test(html) && !/data-pm-slice\s*=/i.test(html) && view.pasteHTML(html, event)) return true;
      // 没有可用的 HTML 时，退回混合文本处理：连续制表符行转表格，其余保留。
      const mixed = mixedTextToMarkdown(text);
      if (mixed) return insertMarkdown(view, ctx, mixed);
      return false;
    },
  },
}));
