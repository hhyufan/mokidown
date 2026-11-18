/**
 * 公式源码态的实时预览气泡。
 *
 * 编辑 `$$` / `$` 公式时正文处于源码态，此处按当前正文同步渲染 KaTeX 预览。
 * 逐字符输入必然经过许多临时不成立的中间态（`\` → `\a` → `\alpha`），
 * 所以语法不成立时沿用上一次成功的样子，避免预览在输入过程中跳成报错文案。
 */
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import katex from 'katex';

// 源码态节点名与文档协议绑定，改动会让已存文档的公式失效。
const sourceTypes = {
  math_source_block: { displayMode: true, variant: 'block' },
  math_source_inline: { displayMode: false, variant: 'inline' },
};

const previewKey = new PluginKey('moki-math-preview');
const MAX_CACHE = 200;
// 行内气泡按锚点对齐中线。两种源码态的盒子分属不同元素，锚点名各一个，
// 免得文档里同时存在两个时气泡指错地方；对应 anchor-name 写在 markdown-preview.scss。
const sourceAnchor = '--moki-math-source';
const revealedAnchor = '--moki-math-revealed';
// 只缓存渲染结果字符串；widget 的 toDOM 每次必须返回新节点，
// 复用同一 DOM 实例会让内容相同的两个公式互相"搬走"对方的节点。
const rendered = new Map();

// 行内源码态存的是 `$正文$`，块级源码态只存正文，需分别取回 LaTeX。
function latexSource(textContent, variant) {
  const text = textContent.trim();
  if (variant !== 'inline') return text;
  const closed = /^\$([\s\S]*)\$$/.exec(text);
  return (closed ? closed[1] : text.replace(/^\$+|\$+$/g, '')).trim();
}

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
  return value && !previewHtml(value, displayMode).error;
}

function renderPreview(value, { displayMode, variant }, anchorName) {
  // 气泡只挂在确认能渲染的正文上，此处不再需要报错分支。
  const bubble = document.createElement('span');
  bubble.className = `moki-math-preview moki-math-preview--${variant}`;
  bubble.innerHTML = previewHtml(value, displayMode).html;
  if (variant !== 'inline') {
    bubble.setAttribute('contenteditable', 'false');
    bubble.setAttribute('aria-hidden', 'true');
    return bubble;
  }
  // 中线对齐交给锚点定位：气泡直接读公式所在元素的真实盒子，正文变宽、折行、
  // 改窗口宽度都自动跟随，不必测量。
  bubble.style.positionAnchor = anchorName;
  // 行内气泡要浮在公式自己那一行上方。绝对定位只认「最近的定位祖先」，而正文里
  // 没有任何元素站在公式的槽位上，所以外面套一个零尺寸的行内锚点：它不占宽度、
  // 不产生断行机会，只负责在锚点定位不可用时提供水平起点与所在行。
  const anchor = document.createElement('span');
  anchor.className = 'moki-math-preview-anchor';
  anchor.setAttribute('contenteditable', 'false');
  anchor.setAttribute('aria-hidden', 'true');
  anchor.append(bubble);
  return anchor;
}

// 气泡的可视范围由最近的滚动祖先决定，正文自己不是滚动容器。
function scrollParent(element) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (/auto|scroll|hidden/.test(getComputedStyle(node).overflowY)) return node;
  }
  return null;
}

// 气泡浮在正文上方，第一行写公式就会被编辑区上沿裁掉；预览比源码宽很多时，
// 按中线居中又会探出左右边界。position-try 判不了这事：它只看「包含块」放得下
// 放不下，而气泡的包含块是那个零宽锚点，量不到编辑区，滚动后更对不上。所以每次
// 更新按可视范围量一次，放不下就翻到下方，探出去就按差值平移收回来的距离。
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

export const milkdownMathPreview = $prose(() => {
  // 「上一次成功的样子」按编辑器实例保存：跨标签页或换文档不会把别的公式的预览带过来。
  const lastGood = new Map();
  let scroller = null;

  return new Plugin({
    key: previewKey,
    view(editorView) {
      const refit = () => fitBubbles(editorView);
      window.addEventListener('resize', refit);
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
          scroller?.removeEventListener('scroll', refit);
          scroller = null;
        },
      };
    },
    props: {
      decorations(state) {
        const { selection, doc } = state;
        const decorations = [];
        const active = new Set();

        const addPreview = (identity, pos, value, spec, anchorName) => {
          active.add(identity);
          // 空正文时 KaTeX 无内容可渲染；正文不成立时保留已有预览。
          if (isPreviewable(value, spec.displayMode)) lastGood.set(identity, value);
          const shown = lastGood.get(identity);
          // 还没成功渲染过就没有可沿用的预览，等用户写出可解析的东西再出现气泡。
          if (!shown) return;
          decorations.push(Decoration.widget(pos, () => renderPreview(shown, spec, anchorName), {
            // 锚点名必须在 key 里：PM 只按 key 决定要不要重建 widget 的 DOM，而锚点是
            // 写在行内样式上的。双击把「光标贴住渲染态」换成源码态时，变体、位置、正文
            // 全都没变，key 也就没变，DOM 被原样复用，气泡还指着已经不存在的
            // --moki-math-revealed，anchor() 整体失效，退回到贴在公式起点的兜底摆法。
            key: `${spec.variant}:${pos}:${shown}:${anchorName}`,
            side: -1,
            stopEvent: () => true,
            ignoreSelection: true,
          }));
        };

        // 气泡排在公式自己前头：块级挂在源码块起点，行内挂在源码节点起点。
        // 行内不能挂在公式之后——夹在节点与后续文字之间的 widget 会让浏览器把
        // End 这类原生光标移动吞掉，光标卡在公式前面出不去；挂在前面就没有这个坑。
        doc.descendants((node, pos) => {
          const spec = sourceTypes[node.type.name];
          if (!spec) return;
          addPreview(`${node.type.name}:${pos}`, pos, latexSource(node.textContent, spec.variant), spec, sourceAnchor);
        });

        // 行内公式被光标贴住时仍是渲染态节点，只是由 milkdownLiveSyntax 的
        // 装饰改显 `$…$` 源码；那种状态下正文里没有源码节点，需在此补上预览。
        const { $from } = selection;
        if ($from.parent.isTextblock && !$from.parent.type.spec.code) {
          const adjacent = selection.empty ? $from.nodeAfter : selection.node;
          if (adjacent?.type.name === 'math_inline') {
            addPreview(`math_inline:${$from.pos}`, $from.pos, String(adjacent.attrs.value || '').trim(), sourceTypes.math_source_inline, revealedAnchor);
          }
        }

        for (const identity of lastGood.keys()) if (!active.has(identity)) lastGood.delete(identity);

        return decorations.length ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
      },
    },
  });
});
