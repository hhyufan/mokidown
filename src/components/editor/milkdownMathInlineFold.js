import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';

const foldKey = new PluginKey('moki-math-inline-fold');
// 正文至少一个字符：`$$` 不是公式，折成空原子只会留下看不见的节点。
const closedSource = /^\$([\s\S]+)\$$/;

/**
 * 行内公式写完收尾 `$` 就立即折叠。
 *
 * 输入规则建立的行内源码节点里，光标一路跟在正文末尾，收尾 `$` 之后再打字
 * 会全部写进公式，句子的后半截就此消失。这里把「光标正好停在完整 `$…$` 的
 * 末尾之后」当作写完的信号，折成渲染原子并把光标送到原子后面，与直接在正文里
 * 打 `$x^2$` 的折叠行为一致。
 *
 * 揭开已有公式时，光标停在收尾 `$` 之前而不是之后，所以这条判断不会把正在
 * 修改的公式抢走；用户真要把光标放到最后再打字，那本来就等于宣布写完了。
 */
export const milkdownMathInlineFold = $prose(() => new Plugin({
  key: foldKey,
  appendTransaction(_transactions, _oldState, state) {
    const { selection, doc } = state;
    const sourceType = state.schema.nodes.math_source_inline;
    const renderedType = state.schema.nodes.math_inline;
    if (!selection.empty || !sourceType || !renderedType) return null;
    const $at = doc.resolve(selection.from);
    const node = $at.parent;
    if (node.type !== sourceType) return null;
    // 光标必须正好在正文最后（收尾 `$` 之后），否则还在正文里接着写。
    if ($at.parentOffset !== node.textContent.length) return null;
    const match = closedSource.exec(node.textContent);
    if (!match) return null;
    const atom = renderedType.create({ value: match[1] });
    const start = $at.before();
    const tr = state.tr.replaceWith(start, start + node.nodeSize, atom);
    // 光标送到原子之后：接着打字写的是正文，不再是公式。
    return tr.setSelection(TextSelection.create(tr.doc, start + atom.nodeSize)).scrollIntoView();
  },
}));
