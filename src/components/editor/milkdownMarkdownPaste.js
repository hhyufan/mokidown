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

function insertMarkdown(view, ctx, markdown) {
  const doc = ctx.get(parserCtx)(String(markdown).replace(/\r\n?/g, '\n'));
  if (!doc) return false;
  view.dispatch(view.state.tr.replaceSelection(Slice.maxOpen(doc.content)).scrollIntoView()
    .setMeta('paste', true).setMeta('uiEvent', 'paste'));
  return true;
}

// Source copied from a code editor often includes highlighted HTML. Prefer
// Markdown in that case, while the stock clipboard plugin handles rich text.
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
      const html = data.getData('text/html');
      if (mode !== 'markdown' && (!/<(?:pre|code)(?:\s|>)/i.test(html) || /data-pm-slice\s*=/i.test(html))) return false;
      const doc = ctx.get(parserCtx)(text.replace(/\r\n?/g, '\n'));
      if (!doc) return false;
      let formatted = false;
      doc.descendants((node) => {
        if ((node.type.name !== 'paragraph' && !node.isText) || node.marks.length) formatted = true;
      });
      if (mode !== 'markdown' && !formatted) return false;
      view.dispatch(view.state.tr.replaceSelection(Slice.maxOpen(doc.content)).scrollIntoView()
        .setMeta('paste', true).setMeta('uiEvent', 'paste'));
      return true;
    },
  },
}));
