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

export const mathMarkName = 'math';

/**
 * 行内公式草稿的区间判定。
 *
 * 打字写出的一对 `$` 先以字面文本留在文档里：删字、移动光标都还是浏览器默认行为，
 * 补齐收尾的 `$$` 才折成 mark。所以「草稿框住了什么」只能从文本里量。
 * 块级入口（行首的 `$$` + 空格）由输入规则先抢走，走不到这里。
 *
 * 正文的右界不是光标，而是光标所在这一段连续 LaTeX 的末尾：空白与 `$` 才算断。
 * 停在 `\int` 中间按左键，屏幕上的式子还是那一个 `\int`，预览与折叠都得按它来，
 * 不然量到光标就只剩 `\in`，排出来是「属于」——看着像选错了符号。
 *
 * 返回的下标是父节点文本坐标，绝对位置由调用方按光标换算。
 */
export function mathDraftRange(value, offset) {
  let body = offset;
  while (body > 0 && /\s/.test(value[body - 1])) body--;
  let closing = false;
  // 收尾的第一个 `$` 已经打进文档，和它前面的空白一起从正文里摘出去。
  // 它左边又是一个 `$` 说明正文还是空的，或者收尾多打了一个——都不是草稿收尾。
  if (body > 0 && value[body - 1] === '$' && value[body - 2] !== '$') {
    closing = true;
    body--;
    while (body > 0 && /\s/.test(value[body - 1])) body--;
  }
  // 光标右边还没写完的那一截属于同一个式子：模板把光标送进 `{}` 时补全的尾巴在这里，
  // 停在宏名中间时后面跟着的字母也在这里。空白、`$` 与占位符（转义符、图片这类非文字
  // 节点）算断——后面那一样只要吃进正文，下面就不再是单个文本节点里的 LaTeX 了。
  while (body < value.length && !/[\s$\ufffc]/.test(value[body])) body++;

  let start = body;
  while (start > 0 && value[start - 1] !== '$') start--;
  let anchor = start;
  while (anchor > 0 && value[anchor - 1] === '$') anchor--;
  if (start - anchor !== 2) return null;
  // 判据与单 `$` 折叠一致：贴着字母数字或反斜杠的 `$` 是正文里的符号，不是定界符。
  if (anchor > 0 && /[\w:/\\]/.test(value[anchor - 1])) return null;

  let from = start;
  while (from < body && /\s/.test(value[from])) from++;
  // 正文跨了换行或占位符就不是单个文本节点里的 LaTeX，换算不出位置。
  if (from >= body || /[\n\r\ufffc]/.test(value.slice(from, body))) return null;
  return { anchor, from, to: body, closing };
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
