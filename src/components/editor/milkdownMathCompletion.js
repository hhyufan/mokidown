/**
 * 公式源码态的符号补全。
 *
 * 光标紧跟在一个还没写完的控制序列（`\` 加若干字母）之后才出现，像编辑器的
 * 代码补全：会写编码的人边打边过滤，不会写的人打个 `\` 就能从列表里挑。
 * 浮层与代码块语言菜单同一套机制，渲染在 body 上、正文里不留节点，所以输入
 * 与光标行为完全不受影响。
 */
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

export const MATH_COMPLETION_EVENT = 'moki:math-completion';

const completionKey = new PluginKey('moki-math-completion');

// symbol 是列表里显示的字符，snippet 是真正写进源码态的 LaTeX 片段。
export const mathSymbolSnippets = [
  ['α', '\\alpha'], ['β', '\\beta'], ['γ', '\\gamma'], ['θ', '\\theta'],
  ['λ', '\\lambda'], ['μ', '\\mu'], ['π', '\\pi'], ['σ', '\\sigma'],
  ['√', '\\sqrt{}'], ['∑', '\\sum_{}'], ['∫', '\\int_{}'], ['∞', '\\infty'],
  ['≠', '\\neq'], ['≈', '\\approx'], ['≤', '\\leq'], ['≥', '\\geq'], ['±', '\\pm'],
  ['a/b', '\\frac{}{}'],
];

// 只有真正的可编辑源码态才补全：行内公式被光标贴住时仍是原子节点，那个位置打不进文字。
const sourceTypeNames = new Set(['math_source_block', 'math_source_inline']);

// `\` 之后只跟字母才算半个控制序列；`\pi ` 已经写完，不再打扰。
const tokenPattern = /\\\p{L}*$/u;

// 纯宏名（`\pi`）后面紧跟字母就会粘成另一个控制序列（`\pir`），所以补一个分隔空格；
// 带反斜杠的下一个宏能自己截断前一个，因此宏接宏不需要空格。
const needsSeparator = (snippet) => /^\\\p{L}+$/u.test(snippet);

// 目录里每个片段的宏名本身。编码已经打全（`\alpha`）时不再补全：列表一开着就会
// 拦住方向键，而向上/向下正是离开公式源码态的手势；没打完（`\al`）才接管。
const completeMacros = new Set(mathSymbolSnippets
  .map(([, snippet]) => /^\\\p{L}+/u.exec(snippet)?.[0])
  .filter(Boolean));

function completionAt(view) {
  const { selection } = view.state;
  const { $from } = selection;
  if (!selection.empty || !sourceTypeNames.has($from.parent.type.name)) return null;
  const match = tokenPattern.exec($from.parent.textContent.slice(0, $from.parentOffset));
  // parentOffset 与文档位置同一个起点，所以直接按片段长度回退就是控制序列的起点。
  return match && { from: $from.pos - match[0].length, query: match[0] };
}

function insertSnippet(view, snippet) {
  const { state } = view;
  const completion = completionAt(view);
  if (!completion) return;
  const text = needsSeparator(snippet) ? `${snippet} ` : snippet;
  const tr = state.tr.insertText(text, completion.from, state.selection.to);
  // 带 `{}` 的模板把光标送进第一对花括号，其余情况停在插入内容之后。
  const braces = text.indexOf('{}');
  tr.setSelection(TextSelection.create(tr.doc, completion.from + (braces === -1 ? text.length : braces + 1)));
  view.dispatch(tr.scrollIntoView());
}

export const milkdownMathCompletion = $prose(() => new Plugin({
  key: completionKey,
  view(editorView) {
    let previous = '';
    // Escape 关掉的那次记住控制序列起点：同一段还没写完时继续打字不该再把列表弹回来，
    // 删干净之后（不再命中）才重新武装。
    let dismissed = null;
    return {
      update(view) {
        const token = view.hasFocus() ? completionAt(view) : null;
        const hit = token && !completeMacros.has(token.query) ? token : null;
        const key = hit && `${hit.from}:${hit.query}`;
        if (key === previous) return;
        previous = key;
        let detail = null;
        if (hit && dismissed !== hit.from) {
          // 只看当下的控制序列，不比文档身份：插件的 key 只跟着 from+query 走，
          // 补全之后常有别的事务改动文档，比身份会让点击悄悄失效。
          const current = () => {
            if (view.isDestroyed) return null;
            const next = completionAt(view);
            return next && next.from === hit.from && next.query === hit.query ? next : null;
          };
          detail = {
            query: hit.query,
            // x 是控制序列片段的起点，列表就跟在它下面；y 是光标所在行的下沿。
            getAnchor: () => {
              const now = current();
              if (!now) return null;
              const { left, top, bottom } = view.coordsAtPos(now.from, 1);
              const pane = view.dom.closest('.md-preview--milkdown')?.getBoundingClientRect();
              if (pane && (bottom <= pane.top || top >= pane.bottom)) return null;
              return { x: left, y: bottom };
            },
            select: (snippet) => { if (current()) insertSnippet(view, snippet); },
            dismiss: () => { dismissed = hit.from; },
          };
        } else if (!hit) {
          dismissed = null;
        }
        editorView.dom.dispatchEvent(new CustomEvent(MATH_COMPLETION_EVENT, { bubbles: true, detail }));
      },
    };
  },
}));
