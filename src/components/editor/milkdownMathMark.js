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
