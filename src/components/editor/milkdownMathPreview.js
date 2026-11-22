/**
 * 公式的实时预览。
 *
 * 块级公式在源码态把预览排在源码块上方。行内公式是一段挂着 `math` mark 的 LaTeX
 * 正文：没在编辑时用 KaTeX 覆盖层压住正文，编辑时正文露出来、预览浮到正文上方。
 * 逐字符输入必然经过许多临时不成立的中间态（`\` → `\a` → `\alpha`），所以气泡沿用
 * 上一次成功的样子，避免预览在输入过程中跳成报错文案。
 * 末尾那个宏还没打完时也不喂 KaTeX：`\in`、`\inf` 恰好是它认得的前缀，
 * 真会排出「属于」和 `inf`，看着就像补全挑错了符号。
 *
 * 行内公式只要展开源码就预览：单击、双击与贴边退格揭开的都是同一种状态，气泡跟着源码走。
 * 什么时候算「在编辑这条公式」由 milkdownMathMark 的 isMathEditing 一处说了算——严格在内、
 * 被鼠标点开过、或正踩在画出来的那枚 `$` 上。贴着边界路过不算，实时语法读的是同一个条件，
 * 两边一起翻态才不会出现「正文还压在覆盖层底下、两头却摆着 `$`」。
 * 光标落在公式边界上时，inclusive:false 本来会把下一笔字送到正文外面，编辑档把 mark 按住，
 * 这一笔才落进式子里。
 *
 * 从零写一条公式走的是草稿：连打两个 `$` 由实时语法补成一对，光标停在中间，那两枚定界符
 * 在这里被染透明（本插件的活儿），光标一走就把定界符删掉、正文挂上 mark 折成公式。
 */
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { Plugin, TextSelection } from '@milkdown/kit/prose/state';
import { closeHistory } from '@milkdown/kit/prose/history';
import { $prose } from '@milkdown/kit/utils';
import { isImeComposing } from '@utils/keyboard';
import katex from 'katex';
import {
  isClicked,
  isMathEditing,
  mathDraftAt,
  mathMarkName,
  previewKey,
} from './milkdownMathMark';
import { delimiterCaret, unfoldMathPair } from './milkdownLiveSyntax';
import { endsWithPartialMacro } from './milkdownMathSymbols';

// 块级源码态的节点名与文档协议绑定，改动会让已存文档的公式失效。
const blockSource = 'math_source_block';
const blockSpec = { displayMode: true, variant: 'block' };
const bubbleSpec = { displayMode: false, variant: 'inline' };
const draftSpec = { displayMode: false, variant: 'inline', draft: true };
const coverSpec = { displayMode: false, variant: 'cover', cover: true };

const MAX_CACHE = 200;
// 只缓存渲染结果字符串；widget 的 toDOM 每次必须返回新节点，
// 复用同一 DOM 实例会让内容相同的两个公式互相"搬走"对方的节点。
const rendered = new Map();

function previewHtml(value, displayMode) {
  const cacheKey = `${displayMode ? 'd' : 'i'}${value}`;
  if (rendered.has(cacheKey)) return rendered.get(cacheKey);
  let html;
  try {
    // KaTeX 默认 trust:false，输出会转义正文，因此可直接作为 innerHTML 注入。
    html = { html: katex.renderToString(value, { displayMode, throwOnError: true, strict: false }) };
  } catch {
    html = { error: true };
  }
  if (rendered.size >= MAX_CACHE) rendered.clear();
  rendered.set(cacheKey, html);
  return html;
}

function isPreviewable(value, displayMode) {
  // 只挡气泡：覆盖层没有「上一次成功」可沿用，非要有东西压住透明正文。
  if (endsWithPartialMacro(value)) return false;
  return value && !previewHtml(value, displayMode).error;
}

// 覆盖层没有「上一次成功」可用：正文被染成透明时不显示点东西就等于凭空少字。
// 所以正文不成立也要摆，退回 KaTeX 自己的报错排字，与旧的渲染态节点表现一致。
function coverHtml(value) {
  const result = previewHtml(value, false);
  if (!result.error) return result;
  return { html: katex.renderToString(value, { displayMode: false, throwOnError: false, strict: false }) };
}

function renderPreview(value, spec) {
  const bubble = document.createElement('span');
  bubble.className = `moki-math-preview moki-math-preview--${spec.variant}`;
  // 预览不许光标进去：浏览器光标一走进非文档内容，PM 就读不回文档位置。
  bubble.setAttribute('contenteditable', 'false');
  bubble.setAttribute('aria-hidden', 'true');
  // 正文为空时不摆东西：气泡只在有正文时才挂上来（见 addBubble）。
  bubble.innerHTML = (spec.cover ? coverHtml(value) : previewHtml(value, spec.displayMode)).html || '';
  if (!spec.draft) return bubble;
  // 草稿正文没挂 mark，PM 又会在 widget 两侧断开装饰 span，气泡在正文里找不到
  // position:relative 的参照物。所以让 widget 自带一个零宽锚点当包含块。
  const anchor = document.createElement('span');
  anchor.className = 'moki-math-draft';
  anchor.append(bubble);
  return anchor;
}

// 一段 LaTeX 可能被拆成好几个文本节点，相邻且同属性的片段并成一个区间。
function mathRanges(doc, type) {
  const ranges = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const mark = type.isInSet(node.marks);
    if (!mark) return;
    const last = ranges.at(-1);
    if (last && last.to === pos && last.mark.eq(mark)) last.to = pos + node.nodeSize;
    else ranges.push({ from: pos, to: pos + node.nodeSize, mark });
  });
  return ranges;
}

// 「什么时候算在编辑这条公式」由 milkdownMathMark 的 isMathEditing 统一判定，实时语法画 `$`
// 用的是同一个条件；这里再判一次就会出现两个插件各说各话的状态。

// 单击为什么要自己记一笔，而不等光标落点说了算：点的位置离首尾那个字近一半，浏览器就把光标
// 放在边界上，inclusive:false 让那个位置读起来是「在旁边打字」，掀开判定不放行。
// 位置要用 PM 的坐标换算而不是量 DOM 盒子：mousedown 已经把定界符画出来，
// 正文在指针底下挪了位，mouseup 再按盒子判就已经偏了。
// `event.detail` 分出这两下：一下把源码掀开，两下再把压在边界上的光标收进正文（见 editPos）。
// 第二下要在 `dblclick` 里收而不是 mouseup——mouseup 时浏览器还没开始选词；可它当场也还没
// 选完，落光标得再等一拍，详见下面那段。
function revealClickedMath(view, event) {
  const { state } = view;
  const double = event.type === 'dblclick';
  if (!view.editable || event.button !== 0) return;
  if (double ? event.detail !== 2 : event.detail !== 1) return;
  const math = state.schema.marks[mathMarkName];
  if (!math) return;
  const ranges = mathRanges(state.doc, math);
  const { head, from: start, to: end } = state.selection;
  // 坐标算不出文档位置也要接着判：第一下把源码揭开之后正文在指针底下挪了位，行盒还从
  // 覆盖层那么高塌回源码那么矮，第二下的坐标常常已经不在字上。那就退回选区那头去量。
  const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? head;
  const range = ranges.find(({ from, to }) => at >= from && at <= to)
    ?? (double ? ranges.find(({ from, to }) => end > from && start < to) : null);
  if (!double) {
    if (range) view.dispatch(state.tr.setMeta(previewKey, { from: range.from, to: range.to }));
    return;
  }
  // 双击第二下交回来的是浏览器的原生选词，可公式刚被第一下重新排过，Chromium 找不回
  // 那个词，退化成整行选中（`正文 $x^2$ 结尾` 量到 8→17）：两头都在公式外面，之后方向键、
  // 打字全都跑偏，定界符与补全也因为选区非空而收走。所以这一下由我们自己落进正文。
  if (range) {
    const pos = editPos(range, at);
    // 落点还得等一拍。浏览器把自己那份选词写进 DOM 比 `dblclick` 事件更晚：当场 dispatch 的
    // 光标要是跟状态里已有的选区一样，PM 就不再去动 DOM 选区，随后 Chromium 那份
    // （`$\in$` 量到 8→9，选中正是开头那个反斜杠）原样盖回来。等它写完，这一下才算落定。
    window.setTimeout(() => {
      if (view.isDestroyed || !view.state.doc.eq(state.doc)) return;
      view.dispatch(editInside(view.state, math, range, pos));
    }, 0);
  }
}

// 指针贴着公式左右边界时，inclusive:false 会把打字送到正文外面，所以往内收一格。
// 只有一个字符的正文没有严格向内的位置，只能停在左边界。
function editPos({ from, to }, caret) {
  return to - from < 2 ? from : Math.min(Math.max(caret, from + 1), to - 1);
}

function editInside(state, math, { from, to }, pos) {
  const tr = state.tr
    .setSelection(TextSelection.create(state.doc, pos))
    .setMeta(previewKey, { from, to });
  // 单字符正文的光标只能压在边界上，而边界上打字会被当成公式外面的普通文字，整个公式
  // 当场散掉。把 mark 记成待插入的 marks，下一笔字才落进正文里。
  if (to - from < 2) tr.setStoredMarks(state.doc.resolve(from).nodeAfter?.marks ?? [math.create()]);
  return tr;
}

// 光标贴在渲染态公式的边上按退格/删除：原本吃掉的是正文最后一个字符，或者整对 `$`
// （`$` 不在文档里，拆掉 mark 反而凭空多出两个 `$`）。这一下改成「我要改这个公式」——
// 源码翻出来、光标落在指针这一侧、一个字符都不删。已经点开就不插手：光标要是还切在画出来的
// 那枚 `$` 上，接着由 unfoldMathPair 把定界符摊成草稿；挪在正文那一格就照常删字，正文删空整段公式自然消失。
function edgeToEdit(state, math, forward) {
  const { selection } = state;
  if (!selection.empty) return null;
  const pos = forward ? selection.from : selection.to;
  const clicked = previewKey.getState(state);
  return mathRanges(state.doc, math).find((range) => (forward
    ? range.from === pos
    : range.to === pos) && !isClicked(clicked, range)) ?? null;
}

function enterAtEdge(view, math, range, forward) {
  const { state } = view;
  // 停在边界上打字会被 inclusive:false 送到公式外面，所以把正文那串 marks 记成待插入的
  // marks：光标点完公式紧接着打字，才落得进正文的头上或尾巴。
  const marks = state.doc.resolve(range.from).nodeAfter?.marks ?? [math.create()];
  view.dispatch(state.tr
    .setSelection(TextSelection.create(state.doc, forward ? range.from : range.to))
    .setStoredMarks(marks)
    .setMeta(previewKey, { from: range.from, to: range.to })
    .scrollIntoView());
}

// 行内公式草稿只在光标停着的时候预览：成对手势打出的那对 `$` 还摊在文档里，正文是一段
// 没挂 mark 的字面文本，光标一走就该折成公式（见 foldDraft）。区间判定与换算都在
// mathDraftAt，补全和实时语法读的是同一份。
function mathDraft(state, ranges) {
  const { selection } = state;
  if (!selection.empty) return null;
  const draft = mathDraftAt(selection.$from);
  // 框进了已有公式（正文里挂着 code mark 的转义符这类）就不算草稿：那两枚 `$` 是画出来的。
  if (!draft || ranges.some(({ from, to }) => draft.close >= from && draft.anchor <= to)) return null;
  return draft;
}

// 光标离开那一对 `$` 才算这个式子写完：定界符从文档里删掉，正文挂上 math mark，
// 屏幕上当场退回渲染态。打字的时候不折——那几笔人还在式子里，正文随时会长。
// 只在纯选区移动的事务上折，两份文档是同一份，区间不用换算。
function foldDraft(transactions, oldState, state, math) {
  if (!transactions.some(({ selectionSet }) => selectionSet)) return null;
  if (transactions.some(({ docChanged }) => docChanged)) return null;
  const { selection } = oldState;
  if (!selection.empty) return null;
  const draft = mathDraftAt(selection.$from);
  // 空对没什么可折的，那两枚 `$` 就是用户要打的字。
  if (!draft || draft.from === draft.to) return null;
  // 选区还搭在这对定界符上（含正好压在收尾那一格）就还没写完。
  if (state.selection.to >= draft.from && state.selection.from <= draft.close) return null;
  const tr = closeHistory(state.tr);
  // 定界符连同它和正文之间的空白一起退场：`$ x $` 排出来与 `$x$` 是同一个式子，把空白留在
  // 句子里只会平白多出一对空格。先删右边那枚，左边的坐标才不用跟着挪。
  tr.delete(draft.to, draft.close + 1).delete(draft.anchor, draft.from);
  const shift = draft.from - draft.anchor;
  return tr.addMark(draft.from - shift, draft.to - shift, math.create());
}

// 气泡的可视范围由最近的滚动祖先决定，正文自己不是滚动容器。
function scrollParent(element) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (/auto|scroll|hidden/.test(getComputedStyle(node).overflowY)) return node;
  }
  return null;
}

// 气泡浮在正文上方，第一行写公式就会被编辑区上沿裁掉；预览比源码宽很多时，
// 按中线居中又会探出左右边界。所以每次更新按可视范围量一次，放不下就翻到下方，
// 探出去就按差值平移收回来的距离。
// 横向用平移而不是贴边，是为了让尾巴始终指着公式——贴到正文末尾会把尾巴撇开几十像素。
function fitBubbles(view) {
  const scroller = scrollParent(view.dom);
  if (!scroller) return;
  const box = scroller.getBoundingClientRect();
  for (const bubble of view.dom.querySelectorAll('.moki-math-preview--inline')) {
    // 先退回默认摆法再量：属性留着的话，量到的是上一次挪完之后的位置。
    bubble.removeAttribute('data-moki-math-preview-side');
    bubble.style.setProperty('--moki-preview-shift', '0px');
    const rect = bubble.getBoundingClientRect();
    if (rect.top < box.top) bubble.dataset.mokiMathPreviewSide = 'below';
    const shift = rect.right > box.right ? box.right - rect.right : rect.left < box.left ? box.left - rect.left : 0;
    bubble.style.setProperty('--moki-preview-shift', `${shift}px`);
  }
}

// 改动是不是整个落在记住的那条公式里：是的话区间跟着打字一起变长，记忆接着用；
// 只要动到了公式外面，坐标就全乱了，按老规矩忘掉。
function staysInside(steps, clicked) {
  return !!clicked && steps.every(({ from, to }) => from >= clicked.from && to <= clicked.to);
}

export const milkdownMathPreview = $prose(() => {
  // 「上一次成功的样子」按编辑器实例保存：跨标签页或换文档不会把别的公式的预览带过来。
  const lastGood = new Map();
  let scroller = null;

  return new Plugin({
    key: previewKey,
    state: {
      init: () => null,
      apply(tr, clicked) {
        const marked = tr.getMeta(previewKey);
        if (marked !== undefined) return marked;
        // 文档一改，区间坐标就全变了。只有改动整段落在记住的那条公式里才跟得上——
        // 贴在公式右边界进编辑态之后接着打字，光标一直压在边界上，一忘就把刚掀开的源码合上了。
        // 两个端点各自往外让一格：敲在首尾那两格上的字属于这条公式，不是把它挤短。
        const memory = !tr.docChanged ? clicked
          : staysInside(tr.steps, clicked)
            ? { ...clicked, from: tr.mapping.map(clicked.from, -1), to: tr.mapping.map(clicked.to, 1) }
            : null;
        if (!memory || !tr.selectionSet) return memory;
        const { from, to } = tr.selection;
        return from === to && from >= memory.from && to <= memory.to ? memory : null;
      },
    },
    // 贴在公式边界打字算改这条公式：mark 是 inclusive:false，本来这一笔会被送到正文外面
    // （`$x^2$` 尾巴上打字变成 `$x^2$A`）。光标一走到边界就把正文那串 marks 记成待插入的
    // marks，这一笔才落进式子的头上或尾巴——进编辑态不必先用退格把源码掀开。
    // 已经摊开的公式里，PM 每敲一个字就把 storedMarks 清空，同一个事务再把 mark 按回去，
    // 光标停在尾巴上也还是在正文里打字。
    appendTransaction(transactions, oldState, state) {
      const math = state.schema.marks[mathMarkName];
      const folded = math && foldDraft(transactions, oldState, state, math);
      if (folded) return folded;
      if (!transactions.some(({ docChanged, selectionSet }) => docChanged || selectionSet)) return null;
      const { selection } = state;
      if (!selection.empty) return null;
      const { $from } = selection;
      const current = state.storedMarks;
      // 待插入 marks 里已经没有 math：这是实时语法把光标送进画出来的那枚 `$`
      // （selectDelimiterPosition 按格子算出的 marks），意思是「下一笔落在公式外面」。
      // 这里再按回去不但抹掉这层意思，还会连带把插件记着的那一格清掉——光标就再也走不出尾巴。
      if (current && !current.some((mark) => mark.type.name === mathMarkName)) return null;
      // 左右邻居都没挂 math 就不贴在公式边上，用不着把整篇扫一遍找区间。
      const beside = (node) => node?.marks.some((mark) => mark.type.name === mathMarkName);
      if (!beside($from.nodeBefore) && !beside($from.nodeAfter)) return null;
      const range = mathRanges(state.doc, math).find(
        ({ from: start, to }) => start === $from.pos || to === $from.pos,
      );
      if (!range) return null;
      const marks = ($from.pos === range.to ? $from.nodeBefore : $from.nodeAfter).marks;
      const same = current?.length === marks.length && current?.every((mark, i) => mark.eq(marks[i]));
      if (same) return null;
      // 只有真的落了一笔字才顺手把这条公式记成「已点开」。光标走到边界本身不算在编辑，
      // 那时候源码还该压着（见 isMathEditing）；字进了正文，才摊开给人接着改。
      const tr = state.tr.setStoredMarks(marks);
      return transactions.some(({ docChanged }) => docChanged)
        ? tr.setMeta(previewKey, { from: range.from, to: range.to })
        : tr;
    },
    view(editorView) {
      const refit = () => fitBubbles(editorView);
      const onClick = (event) => revealClickedMath(editorView, event);
      window.addEventListener('resize', refit);
      editorView.dom.addEventListener('mouseup', onClick);
      editorView.dom.addEventListener('dblclick', onClick);
      return {
        // 插件视图在文档同步之后才跑，这时气泡已经在 DOM 里，量到的是最终位置。
        update() {
          if (scroller?.isConnected) return refit();
          scroller?.removeEventListener('scroll', refit);
          scroller = scrollParent(editorView.dom);
          scroller?.addEventListener('scroll', refit, { passive: true });
          refit();
        },
        destroy() {
          window.removeEventListener('resize', refit);
          editorView.dom.removeEventListener('mouseup', onClick);
          editorView.dom.removeEventListener('dblclick', onClick);
          scroller?.removeEventListener('scroll', refit);
          scroller = null;
        },
      };
    },
    props: {
      handleKeyDown(view, event) {
        const forward = event.key === 'Delete';
        if (event.key !== 'Backspace' && !forward) return false;
        if (!view.editable || view.composing || isImeComposing(event)
          || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
        const math = view.state.schema.marks[mathMarkName];
        const range = math && edgeToEdit(view.state, math, forward);
        if (range) {
          event.preventDefault();
          enterAtEdge(view, math, range, forward);
          return true;
        }
        // 源码已经摊开了，光标还切在画出来的那枚 `$` 上：这一下把两枚定界符落回文档，
        // 摊成初次打 `$` 那种草稿，同一键再走一下才真删掉它们。
        if (!unfoldMathPair(view, forward)) return false;
        event.preventDefault();
        return true;
      },
      decorations(state) {
        const { doc, selection } = state;
        const decorations = [];
        const active = new Set();

        // widget 不带 marks:[]，才会嵌进 math mark 自己的 span 里，被那个
        // position:relative 的盒子当包含块——覆盖层和气泡都靠这一点对齐正文。
        const attach = (pos, value, spec, side, key) => decorations.push(Decoration.widget(pos,
          () => renderPreview(value, spec),
          { key, side, stopEvent: () => true, ignoreSelection: true }));

        // 正文不成立时沿用上一次成功的样子；还没成功渲染过就没有可沿用的预览，
        // 等用户写出可解析的东西再出现气泡。
        // `$$` 中间没排出任何东西就不预览：空框只会让人以为式子已经成立。正文被清空时
        // 记住的那一份也一并忘掉——清空就是「这条公式还没有内容」，不该继续挂着旧样子。
        const addBubble = (identity, pos, value, spec, side) => {
          active.add(identity);
          if (!value.trim()) lastGood.delete(identity);
          else if (isPreviewable(value, spec.displayMode)) lastGood.set(identity, value);
          const shown = lastGood.get(identity);
          if (shown) attach(pos, shown, spec, side, `${spec.variant}:${pos}:${shown}`);
        };

        // 块级气泡排在源码块前头：挂在它后面会让预览和源码块上下颠倒。
        doc.descendants((node, pos) => {
          if (node.type.name === blockSource) addBubble(`${blockSource}:${pos}`, pos, node.textContent.trim(), blockSpec, -1);
        });

        const math = state.schema.marks[mathMarkName];
        const ranges = math ? mathRanges(doc, math) : [];
        // 踩在画出来的那枚 `$` 上也算在编辑：格子是实时语法落的，源码这时候必须还摊着。
        const caret = math ? delimiterCaret(state) : null;
        for (const range of ranges) {
          const value = doc.textBetween(range.from, range.to);
          if (!isMathEditing(state, selection, caret, range)) {
            decorations.push(Decoration.inline(range.from, range.to, { class: 'moki-math-rendered' }));
            attach(range.from, value, coverSpec, 1, `cover:${range.from}:${value}`);
            continue;
          }
          decorations.push(Decoration.inline(range.from, range.to, { class: 'moki-math-source' }));
          addBubble(`math:${range.from}`, range.from, value, bubbleSpec, 1);
        }

        // 草稿的 `$` 和正文都还是普通文字，气泡没有 mark span 可以挂靠，
        // 定位参照由 widget 自带的零宽锚点提供。锚点摆在正文正中，气泡就正好压在正文上方。
        const draft = math ? mathDraft(state, ranges) : null;
        if (draft) {
          // 初次编辑按双击进入的编辑态那一套摆：两枚 `$` 用与虚拟定界符同样的淡色露出来，
          // 中间那段正文挂上源码配色。折成 mark 的那一下少的只是定界符，字色字体都不跳。
          for (const pos of [draft.anchor, draft.close]) {
            decorations.push(Decoration.inline(pos, pos + 1, { class: 'moki-math-draft-marker' }));
          }
          // 源码配色铺满两枚 `$` 之间那一整截，连 `from`/`to` 裁掉的首尾空白也算进去：装饰边界
          // 要是压在草稿正文和收尾那枚 `$` 之间，`$$` 收尾那一下就认不到定界符，实测变成再开一对
          // 空草稿——既不跳过定界符，也不折。
          if (draft.anchor + 1 < draft.close) {
            decorations.push(Decoration.inline(draft.anchor + 1, draft.close, { class: 'moki-math-source' }));
          }
          addBubble(`draft:${draft.anchor}`, draft.from + ((draft.to - draft.from) >> 1),
            doc.textBetween(draft.from, draft.to), draftSpec, 1);
        }

        for (const identity of lastGood.keys()) if (!active.has(identity)) lastGood.delete(identity);

        return decorations.length ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
      },
    },
  });
});
