/**
 * 行内公式的 mark 形状。
 *
 * 与斜体、行内代码同一套机制：文档里只存 LaTeX 正文并挂一个 `math` mark，`$`
 * 定界符不进文档，由 milkdownLiveSyntax 的虚拟渲染补出来，KaTeX 结果作为覆盖层
 * 浮在正文之上。旧的 `math_inline` 原子节点把渲染结果和可编辑正文塞进同一个节点，
 * 方向键、退格、边界打字都得靠补丁抢回光标，实测每次翻态还会让相邻行重新排版。
 *
 * `priority: 1000` 不只是 DOM 包裹顺序：序列化器按优先级升序跑 mark，命中即短路，
 * 数值最高的 mark 才能成为最内层。反过来讲，优先级低于 emphasis 会让 `*$x^2$*`
 * 在写回 Markdown 时丢掉斜体。
 */
import { $markSchema } from '@milkdown/kit/utils';
import { PluginKey } from '@milkdown/kit/prose/state';
import { syntaxScanText } from './milkdownRawText';

export const mathMarkName = 'math';

/**
 * 行内公式草稿的区间判定。
 *
 * 成对手势打出的是 `$` 与 `$`，正文夹在中间；两枚都还是文档里的字面文本，光标一离开
 * 才由预览插件折成 mark。所以「草稿框住了什么」只能从文本里量。
 * 块级入口（空对里按空格）由输入规则先抢走，走不到这里。
 *
 * 一对 `$` 得闭合才算草稿：从光标向左找到最近的一枚是开界符，向右找到最近的一枚是收尾，
 * 中间那段就是正文。`\alpha + \beta` 里那两个空格本来就是式子的一部分，照样吃进正文；
 * 只有整段正文摊得出空白（`$ $`）才算还没开始写式子。停在 `\int` 中间按左键，屏幕上的
 * 式子还是那一个 `\int`，预览与折叠都按整段来。
 *
 * 开界符的判据与 `pendingMarkers`、单 `$` 折叠同源：贴着字母数字冒号反斜杠的 `$` 是正文里
 * 的价钱符号；连写的 `$$` 归块级残留管，成对分开的单枚才是这里的开收尾。
 *
 * 返回的下标是父节点文本坐标：`anchor` 与 `close` 是两枚定界符，`from` 到 `to` 是去掉两端
 * 空白之后的正文。正文为空即刚打开的空对，调用方自己决定拿它当不当式子。
 */
export function mathDraftRange(value, offset) {
  let body = offset;
  while (body > 0 && value[body - 1] !== '$') body--;
  const anchor = body - 1;
  // 走到段首也没撞上 `$`：光标左边根本没有开界符。
  if (anchor < 0) return null;
  let close = offset;
  while (close < value.length && value[close] !== '$') close++;
  // 右边没有 `$` 就还没闭合，摊着的只是半截符号，别急着当公式。
  if (value[close] !== '$') return null;
  if (value[anchor - 1] === '$' || value[close + 1] === '$') return null;
  if (anchor > 0 && /[\w:/\\]/.test(value[anchor - 1])) return null;
  // 正文跨了换行或占位符就不是单个文本节点里的 LaTeX，折起来会把别的节点一起框进来。
  if (/[\n\r\ufffc]/.test(value.slice(anchor + 1, close))) return null;
  let from = anchor + 1;
  while (from < close && /\s/.test(value[from])) from++;
  let to = close;
  while (to > from && /\s/.test(value[to - 1])) to--;
  // 空对（`$|$`）是刚落下的那一下，等的是接着打字；只摊着一串空白的那对不算开始写式子。
  if (from >= to && anchor + 1 !== close) return null;
  return { anchor, from, to, close };
}

/**
 * 光标所在那段草稿的文档位置。区间判定与下标换算只有一份，预览、补全和实时语法都读它，
 * 免得出现「预览当它是公式、补全却不认」这类两边判定不一致的坏法。
 */
export function mathDraftAt($caret) {
  const { parent } = $caret;
  if (!parent.isTextblock || parent.type.spec.code) return null;
  // 代码里的 `$` 是正文：math mark 自己也算 code，mark 内的情形由调用方另挡。
  if ($caret.marks().some((mark) => mark.type.spec.code)) return null;
  const offset = $caret.parentOffset;
  const draft = mathDraftRange(syntaxScanText(parent), offset);
  if (!draft) return null;
  // 扫描文本与文档位置一个一个对上，换算只是把父节点下标平移成绝对位置。
  const at = (index) => $caret.pos - (offset - index);
  return {
    anchor: at(draft.anchor),
    from: at(draft.from),
    to: at(draft.to),
    close: at(draft.close),
  };
}

/**
 * 「这条公式正在编辑」的唯一判定。
 *
 * 摊开源码（预览插件）和画出那两枚 `$`、切出光标格子（实时语法）必须读同一个条件，
 * 否则就会出现「屏幕两边摆着 `$`、正文却还压在 KaTeX 覆盖层底下」这种两边各说各话的状态。
 * 键放在这里，两个插件都从这片叶子导入，谁都不绕着谁。
 */
export const previewKey = new PluginKey('moki-math-preview');

// 展开源码的条件是光标整个落在公式里。按「与选区相交就展开」写的话，Ctrl+A 会把
// 全文公式一起掀开，整篇重排。空光标还要更严一档，必须严格在内：贴在公式左右边界打字
// 落在正文外面，那时候掀开源码反而对不上手。
// 非空选区允许正好框住整段——双击选词拿到的就是这个形状。
export function isRevealed({ from, to }, range) {
  if (from === to) return from > range.from && to < range.to;
  return from >= range.from && to <= range.to;
}

// 点在公式正文上（含首尾那个字的两半边）时，浏览器给的光标正好压在边界上，
// 上面那条严格在内的判定不放行，看起来就是「单击没反应」；正文只有一个字符时
// 根本没有向内的光标位，永远掀不开。鼠标这一下点的是这段正文，所以额外记住
// 「刚被点开的公式」，让源码翻出来。光标挪走或文档一改就忘。
export function isClicked(clicked, range) {
  return !!clicked && clicked.from === range.from && clicked.to === range.to;
}

/**
 * 三种情形算在编辑：光标严格在内、被鼠标点开过、正踩在这条公式画出来的那枚定界符上。
 *
 * 踩格子只可能是从正文里走出来的——贴在边界路过不落格子（这正是与斜体那类标记的差别：
 * 它们的源码就是渲染结果，没有再盖一层预览这回事，贴边摊开也不矛盾）。
 * `caret` 由实时语法记着，没走过定界符就是 null。
 */
export function isMathEditing(state, selection, caret, range) {
  return (
    isRevealed(selection, range) ||
    isClicked(previewKey.getState(state), range) ||
    (!!caret && (selection.from === range.from || selection.from === range.to))
  );
}

export const milkdownMathMark = $markSchema(mathMarkName, () => ({
  inclusive: false,
  code: true,
  priority: 1000,
  parseDOM: [{ tag: 'span[data-moki-math-mark]' }],
  toDOM: () => ['span', { 'data-moki-math-mark': '' }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'inlineMath',
    runner: (state, node, type) => state.openMark(type).addText(node.value).closeMark(type),
  },
  toMarkdown: {
    match: (mark) => mark.type.name === mathMarkName,
    runner: (state, mark, node) => {
      state.withMark(mark, 'inlineMath', node.text || '');
      return true;
    },
  },
}));
