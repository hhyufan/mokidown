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

function renderPreview(value, { displayMode, variant }) {
  // 气泡只挂在确认能渲染的正文上，此处不再需要报错分支。
  const dom = document.createElement('span');
  dom.className = `moki-math-preview moki-math-preview--${variant}`;
  dom.setAttribute('contenteditable', 'false');
  dom.setAttribute('aria-hidden', 'true');
  dom.innerHTML = previewHtml(value, displayMode).html;
  return dom;
}

export const milkdownMathPreview = $prose(() => {
  // 「上一次成功的样子」按编辑器实例保存：跨标签页或换文档不会把别的公式的预览带过来。
  const lastGood = new Map();

  return new Plugin({
    key: previewKey,
    props: {
      decorations(state) {
        const { selection, doc } = state;
        const decorations = [];
        const active = new Set();

        const addPreview = (identity, pos, value, spec) => {
          active.add(identity);
          // 空正文时 KaTeX 无内容可渲染；正文不成立时保留已有预览。
          if (isPreviewable(value, spec.displayMode)) lastGood.set(identity, value);
          const shown = lastGood.get(identity);
          // 还没成功渲染过就没有可沿用的预览，等用户写出可解析的东西再出现气泡。
          if (!shown) return;
          decorations.push(Decoration.widget(pos, () => renderPreview(shown, spec), {
            key: `${spec.variant}:${pos}:${shown}`,
            side: -1,
            stopEvent: () => true,
            ignoreSelection: true,
          }));
        };

        // 气泡排在输入位置上方：块级挂在源码块起点，行内挂在所在段落起点。
        // 行内不能挂在公式原子节点之后，夹在节点与后续文字之间的 widget 会让
        // 浏览器把 End 这类原生光标移动吞掉，光标就卡在公式前面出不去。
        doc.descendants((node, pos) => {
          const spec = sourceTypes[node.type.name];
          if (!spec) return;
          const at = spec.variant === 'inline' ? doc.resolve(pos).start() : pos;
          addPreview(`${node.type.name}:${pos}`, at, latexSource(node.textContent, spec.variant), spec);
        });

        // 行内公式被光标贴住时仍是渲染态节点，只是由 milkdownLiveSyntax 的
        // 装饰改显 `$…$` 源码；那种状态下正文里没有源码节点，需在此补上预览。
        const { $from } = selection;
        if ($from.parent.isTextblock && !$from.parent.type.spec.code) {
          const adjacent = selection.empty ? $from.nodeAfter : selection.node;
          if (adjacent?.type.name === 'math_inline') {
            addPreview(`math_inline:${$from.pos}`, $from.start(), String(adjacent.attrs.value || '').trim(), sourceTypes.math_source_inline);
          }
        }

        for (const identity of lastGood.keys()) if (!active.has(identity)) lastGood.delete(identity);

        return decorations.length ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
      },
    },
  });
});
