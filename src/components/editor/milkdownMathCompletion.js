/**
 * 公式源码态的符号补全。
 *
 * 光标落在一个还没写完的控制序列（`\` 加若干字母）里才出现，像编辑器的代码补全：
 * 会写编码的人边打边过滤，不会写的人打个 `\` 就能从列表里挑。
 * 刚敲下 `$$`、正文还是空的行内草稿也算数，列表当场摊开，不等人想起来打反斜杠。
 * 块级公式源码态、行内公式的 mark 正文、还没闭合的 `$$` 草稿共用同一张符号表，
 * 但行内公式得先双击或用键盘进过编辑态——单击只是看源码，不打扰。
 * 浮层与代码块语言菜单同一套机制，渲染在 body 上、正文里不留节点，所以输入
 * 与光标行为完全不受影响。
 */
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { mathDraftRange, mathMarkName } from './milkdownMathMark';
import { syntaxScanText } from './milkdownRawText';
import { isMathInspecting } from './milkdownMathPreview';
import { completeMacros, hasCandidate, needsSeparator } from './milkdownMathSymbols';

export const MATH_COMPLETION_EVENT = 'moki:math-completion';

const completionKey = new PluginKey('moki-math-completion');

// 块级公式源码态：整段文本都是 LaTeX。
const sourceTypeNames = new Set(['math_source_block']);

// 行内公式的 LaTeX 只占段落里一小段，先量出这一段的起点。
// mark 正文要光标严格落在里面才算数：mark 是 inclusive:false，贴在左右边界打字
// 落在公式外面，那时候补进去的宏会掉进正文，还会把定界符吃掉。
function inlineMathStart($caret, type) {
  if (!type || !$caret.textOffset) return null;
  const { parent } = $caret;
  const index = $caret.index();
  if (!type.isInSet(parent.maybeChild(index).marks)) return null;
  let from = $caret.pos - $caret.textOffset;
  for (let i = index - 1; i >= 0 && type.isInSet(parent.child(i).marks); i--) from -= parent.child(i).nodeSize;
  return from;
}

// 还没闭合的 `$$` 草稿：`$` 和正文都还是普通文字，但用户已经在写 LaTeX 了，
// 同一张符号表不该只有块级用得上。区间判定与预览共用 mathDraftRange。
function draftStart($caret) {
  const { parent } = $caret;
  if (!parent.isTextblock || parent.type.spec.code) return null;
  // 代码里的 `$` 是正文：math mark 自己也算 code，所以这条只挡 mark 之外的情形。
  if ($caret.marks().some((mark) => mark.type.spec.code)) return null;
  const draft = mathDraftRange(syntaxScanText(parent), $caret.parentOffset);
  return draft && $caret.pos - ($caret.parentOffset - draft.from);
}

// 正文还空着的 `$$|`：mathDraftRange 只认得写了字的草稿，这一段单独量出来，好让
// 刚起手的用户直接看见符号表。定界符判据与草稿同源——贴着字母数字或反斜杠的 `$`
// 是正文里的价钱符号，代码里的是字面字符；块级源码态整段都是 LaTeX，用不着这一档。
function emptyDraftAt($caret) {
  const { parent } = $caret;
  if (sourceTypeNames.has(parent.type.name)) return null;
  if (!parent.isTextblock || parent.type.spec.code) return null;
  if ($caret.marks().some((mark) => mark.type.spec.code)) return null;
  const value = syntaxScanText(parent);
  const offset = $caret.parentOffset;
  if (value[offset - 1] !== '$' || value[offset - 2] !== '$') return null;
  // 连写三个 `$` 起不了草稿；贴着字母数字或反斜杠的那一个是正文里的符号。
  if (value[offset - 3] === '$') return null;
  if (offset > 2 && /[\w:/\\]/.test(value[offset - 3])) return null;
  return { from: $caret.pos, to: $caret.pos, query: '' };
}

const letterPattern = /\p{L}/u;

// 光标所在的那一整段控制序列：`\` 之后只跟字母才算半个控制序列，`\pi ` 已经写完不再打扰。
// 只量到光标为止会把宏切成两半：`$\in$` 双击进编辑态，光标常落在 `\|in`，查询就只剩
// 一个 `\`——整张表都摊开（本该按 `\in` 只剩两行），挑中 `\infty` 也只替换掉那个反斜杠，
// 写出 `\infty in`，屏幕上多一坨游离的字母。
// 右边那段字母先在表里试一次：试不出候选就说明它不是用户正在补的宏，而是在 `e^2` 前面
// 补 `\pi` 那种情形，退回光标左边那截，插入照常带分隔空格。
// 两个方向都只在这一段连续的字母里走，反斜杠之外的边界（空格、`$`、图片这类非文字节点）
// 天然把范围挡住，补全不会把公式外面的字一起吞进来。
function macroToken($caret) {
  const before = $caret.nodeBefore?.text;
  if (!before) return null;
  let start = before.length;
  while (start > 0 && letterPattern.test(before[start - 1])) start--;
  if (before[start - 1] !== '\\') return null;
  start--;
  const after = $caret.nodeAfter?.text;
  let end = 0;
  while (end < after?.length && letterPattern.test(after[end])) end++;
  const from = $caret.pos - (before.length - start);
  const full = `${before.slice(start)}${after?.slice(0, end) ?? ''}`;
  if (end && hasCandidate(full)) return { from, to: $caret.pos + end, query: full };
  return { from, to: $caret.pos, query: before.slice(start) };
}

function completionAt(view) {
  const { state } = view;
  const { $from, empty } = state.selection;
  if (!empty) return null;
  if (sourceTypeNames.has($from.parent.type.name)) return macroToken($from);
  // 这一段只用来确认光标确实落在 LaTeX 里（mark 正文或还没闭合的草稿），区间本身
  // 由 macroToken 按控制序列量。
  const region = inlineMathStart($from, state.schema.marks[mathMarkName]) ?? draftStart($from);
  // 草稿刚起手时 mathDraftRange 量不到正文，region 也就是空的，那正是唯一该在没打完
  // 控制序列时就摊开列表的时刻。
  if (region === null || region === undefined) return emptyDraftAt($from);
  return macroToken($from);
}

function insertSnippet(view, snippet) {
  const { state } = view;
  const completion = completionAt(view);
  if (!completion) return;
  const text = needsSeparator(snippet) ? `${snippet} ` : snippet;
  // 替换的是整段控制序列，不是光标左边那一截：`to` 与 `from` 同源才不会让宏名尾巴
  // 剩下几个游离字母。marks 也得自己带上——insertText 只沿用区间右侧的 marks，而
  // math 是 inclusive:false，整段宏名换掉时右侧就是公式外面的正文，`$` 会跟着一起丢。
  const marks = state.doc.resolve(completion.from).nodeAfter?.marks ?? state.selection.$from.marks();
  const tr = state.tr.replaceWith(completion.from, completion.to, state.schema.text(text, marks));
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
        // 行内公式被单击「只看源码」时不弹列表：那一档还没进编辑态，弹出来等于替用户
        // 决定了他要补全什么。判定和预览浮层共用预览插件记下的那一份记忆。
        const token = view.hasFocus() && !isMathInspecting(view.state) ? completionAt(view) : null;
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
