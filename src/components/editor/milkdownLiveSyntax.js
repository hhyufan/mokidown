import { parserCtx, serializerCtx } from '@milkdown/kit/core';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { closeHistory, undo } from '@milkdown/kit/prose/history';
import { Fragment } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { EditorView as CodeMirrorView } from '@codemirror/view';
import { $inputRule, $nodeSchema, $prose } from '@milkdown/kit/utils';
import { isImeComposing } from '@utils/keyboard';
import useConfigStore from '@store/useConfigStore';
import { activeMarkdownPairs, emptyAsteriskPair, emptyMarkdownMarkPair, markdownAsteriskEdit, markdownBacktickEdit, markdownBrackets, markdownPairDeletion, markdownPairEnabled, matchingMarkdownBracket } from '@utils/markdownPairs';
import { CODE_FENCE_LANGUAGE_EVENT, completedFenceLanguage, readMarkdownFence } from '@utils/markdownCodeFence';
import { markdownPopupScroller } from './editorPopupPlacement';
import { isMathEditing, mathDraftAt, mathDraftRange, mathMarkName } from './milkdownMathMark';
import { characterEscapeMarkName, syntaxScanText } from './milkdownRawText';

const sourceTypeName = 'moki_inline_syntax_source';
export const liveSyntaxKey = new PluginKey('moki-live-syntax');
const inlinePointerGestures = new WeakMap();
const inlineLinkPattern = /(?<!\\)!?\[([^\n[\]]*)\]\((?:[^()\n]|\([^()\n]*\))*\)$/;
const graphemes = Intl.Segmenter && new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const autoOpenedFences = new WeakSet();
const inlineCompositions = new WeakMap();

// Typing the full language name already opens the block. A following Enter
// confirms that fence once, rather than inserting an empty first code line.
function clearFenceConfirmation(view) {
  return autoOpenedFences.delete(view.dom.closest('.milkdown-code-block'));
}

export const milkdownFenceConfirmation = [
  CodeMirrorView.domEventHandlers({
    keydown(event, view) {
      if (['Shift', 'Alt', 'Control', 'Meta'].includes(event.key)) return false;
      return (
        clearFenceConfirmation(view) &&
        event.key === 'Enter' &&
        !event.repeat &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !view.composing &&
        !isImeComposing(event) &&
        view.state.doc.length === 0
      );
    },
    pointerdown(_event, view) {
      clearFenceConfirmation(view);
    },
    blur(_event, view) {
      clearFenceConfirmation(view);
    },
  }),
  CodeMirrorView.updateListener.of((update) => {
    if (update.docChanged) clearFenceConfirmation(update.view);
  }),
];

// Preserve unfinished delimiters verbatim through the Markdown serializer.
export const milkdownInlineSyntaxSource = $nodeSchema(sourceTypeName, () => ({
  inline: true,
  group: 'inline',
  content: 'text*',
  marks: '',
  code: true,
  parseDOM: [{ tag: 'span[data-moki-inline-source]', preserveWhitespace: 'full' }],
  toDOM: () => ['span', { 'data-moki-inline-source': '' }, 0],
  parseMarkdown: { match: () => false, runner: () => {} },
  toMarkdown: {
    match: (node) => node.type.name === sourceTypeName,
    runner: (state, node) => state.addNode('html', undefined, node.textContent),
  },
}));

function markDelimiters(mark, text) {
  const marker = mark.attrs.marker === '_' ? '_' : '*';
  switch (mark.type.name) {
    case 'emphasis': return [marker, marker];
    case 'strong': return [marker.repeat(2), marker.repeat(2)];
    case 'strike_through': return ['~~', '~~'];
    // 行内公式的定界符不进文档：正文只存 LaTeX，两个 `$` 由这里画出来。
    // 于是序列化交回 remark 的永远是「mark + 正文」，结构上就写不出双层 `$`。
    case 'math': return ['$', '$'];
    case 'inlineCode': {
      let length = 1;
      for (const match of text.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
      const fence = '`'.repeat(length);
      const padding = /^`|`$|^ .* $/s.test(text) && /[^ ]/.test(text) ? ' ' : '';
      return [fence + padding, padding + fence];
    }
    case 'link': {
      const href = String(mark.attrs.href || '');
      const destination = /\s/.test(href)
        ? `<${href.replace(/>/g, '\\>')}>`
        : href.replace(/[()\\]/g, '\\$&');
      const title = mark.attrs.title ? ` "${mark.attrs.title.replace(/["\\]/g, '\\$&')}"` : '';
      return ['[', `](${destination}${title})`];
    }
    default:
      return null;
  }
}

function activeMarkRanges($caret, side = 1) {
  const { parent } = $caret;
  const previous = side < 0 && !$caret.textOffset;
  const index = $caret.index() - Number(previous);
  if (index < 0) return [];
  const child = parent.maybeChild(index);
  if (!child) return [];
  const start = $caret.pos - (previous ? child.nodeSize : $caret.textOffset);
  return child.marks.flatMap((mark, order) => {
    let from = start,
      to = start + child.nodeSize;
    for (let i = index - 1; i >= 0 && mark.isInSet(parent.child(i).marks); i--)
      from -= parent.child(i).nodeSize;
    for (let i = index + 1; i < parent.childCount && mark.isInSet(parent.child(i).marks); i++)
      to += parent.child(i).nodeSize;
    const text = mark.type.spec.code
      ? parent.textBetween(from - $caret.start(), to - $caret.start())
      : '';
    const delimiters = markDelimiters(mark, text);
    return delimiters ? [{ from, to, order, delimiters, mark }] : [];
  });
}

// 公式的定界符只在「这条公式正在编辑」时才摆出来（判定见 isMathEditing）：光标贴着边界路过
// 既不落格子也不画 `$`，正文保持渲染态。斜体那类标记照旧贴边就摊开——它们的源码就是渲染
// 结果，摊开不改变任何东西。
function editableRanges(state, selection, caret, ranges) {
  return ranges.filter(
    ({ mark, from, to }) =>
      mark.type.name !== mathMarkName || isMathEditing(state, selection, caret, { from, to }),
  );
}

function offsetForMarks(parts, marks) {
  let offset = 0;
  for (const part of parts) {
    if (part.mark && part.opens !== part.mark.isInSet(marks)) break;
    offset += part.text.length;
  }
  return offset;
}

// 光标正踩在第几格定界符上，只有实时语法自己知道。公式预览读这一格，才能和这里画出的 `$`
// 用同一个「在编辑」判定——两边各判各的，就会出现正文压在覆盖层底下、两边却摆着 `$` 的矛盾态。
// 只读预览不挂实时语法，压根没有格子可问。
export function delimiterCaret(state) {
  const syntax = liveSyntaxKey.getState(state);
  if (!syntax) return null;
  return syntax.pointer ? syntax.pointer.caret : syntax.caret;
}

// 按下到抬起之间那一段，标记层冻在点击前的选区上：原生选词与拖动选中正在进行，正文不能在
// 指针底下重排。公式预览摊开源码要读同一个选区，否则源码先摊开、`$` 等抬起才补上，
// 中间露出一拍只有 `\alpha` 的样子。
export function pendingPointerSelection(state) {
  return liveSyntaxKey.getState(state)?.pointer?.selection ?? state.selection;
}

function delimiterBoundary(
  state,
  $pos,
  selection = state.selection,
  caret = liveSyntaxKey.getState(state).caret,
) {
  if (!$pos.parent.isTextblock || $pos.parent.type.spec.code || $pos.textOffset) return null;
  const closing = editableRanges(state, selection, caret, activeMarkRanges($pos, -1))
    .filter(({ to }) => to === $pos.pos)
    .sort((a, b) => b.from - a.from || b.order - a.order);
  const opening = editableRanges(state, selection, caret, activeMarkRanges($pos))
    .filter(({ from }) => from === $pos.pos)
    .sort((a, b) => b.to - a.to || a.order - b.order);
  const heading = $pos.parent.type.name === 'heading' && $pos.parentOffset === 0;
  const parts = closing.map(({ mark, delimiters, from, to }) => ({
    mark,
    text: delimiters[1],
    opens: false,
    from,
    to,
  }));
  const closingLength = parts.reduce((length, { text }) => length + text.length, 0);
  if (heading) parts.push({ text: '#'.repeat($pos.parent.attrs.level) });
  parts.push(
    ...opening.map(({ mark, delimiters, from, to }) => ({
      mark,
      text: delimiters[0],
      opens: true,
      from,
      to,
    })),
  );
  if (!parts.length) return null;
  const text = parts.map((part) => part.text).join('');
  const marks = liveSyntaxKey.getState(state).pointer?.marks ??
    ($pos.pos === state.selection.from ? state.storedMarks ?? $pos.marks() : $pos.marks());
  return {
    text,
    parts,
    closingLength,
    defaultOffset: offsetForMarks(parts, marks),
  };
}

function insideDelimiter(boundary, offset) {
  let end = 0;
  return boundary?.parts.some(({ text }) => {
    const start = end;
    end += text.length;
    return start < offset && offset < end;
  });
}

function revealsDelimiter(mark, marks, inside) {
  return inside || mark.type.name === mathMarkName || mark.isInSet(marks);
}

function adjacentVisibleDelimiter(state, $pos, forward) {
  const boundary = delimiterBoundary(state, $pos);
  if (!boundary) return null;
  const offset = liveSyntaxKey.getState(state).caret?.offset ?? boundary.defaultOffset;
  const inside = insideDelimiter(boundary, offset);
  const marks = state.storedMarks ?? $pos.marks();
  let adjacent = null;
  let end = 0;
  for (const part of boundary.parts) {
    const start = end;
    end += part.text.length;
    if (part.mark && !revealsDelimiter(part.mark, marks, inside)) continue;
    if (forward && offset < end) return { part, index: Math.max(0, offset - start) };
    if (!forward && offset > start) {
      adjacent = { part, index: Math.min(part.text.length - 1, offset - start - 1) };
    }
  }
  return adjacent;
}

// A mark delimiter has no ProseMirror document positions of its own. Keep
// its caret offset in plugin state and leave the document untouched.
function selectDelimiterPosition(view, $pos, boundary, offset, scroll = true, math) {
  const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, $pos.pos));
  const meta = { pointer: null, math };
  if (boundary) {
    let marks = $pos.nodeBefore?.marks || [];
    let end = 0;
    for (const { mark, text, opens } of boundary.parts) {
      end += text.length;
      if (!mark || offset < end) continue;
      marks = opens ? mark.addToSet(marks) : mark.removeFromSet(marks);
    }
    tr.setStoredMarks(marks);
    if (offset !== offsetForMarks(boundary.parts, marks)) meta.caret = { offset };
    const insideMath = marks.some((mark) => mark.type.name === mathMarkName);
    if (math === null && insideMath) {
      const range = [...activeMarkRanges($pos), ...activeMarkRanges($pos, -1)].find(
        ({ mark }) => mark.type.name === mathMarkName && mark.isInSet(marks),
      );
      if (range) meta.math = { from: range.from, to: range.to, inspect: true };
    } else if (math === undefined && !insideMath && boundary.parts.some(({ mark }) => mark?.type.name === mathMarkName)) {
      meta.math = null;
    }
  }
  tr.setMeta(liveSyntaxKey, meta);
  view.dispatch(scroll ? tr.scrollIntoView() : tr);
  return true;
}

function moveAcrossDelimiters(view, direction) {
  const { state } = view;
  const { $from } = state.selection;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return false;
  const caret = liveSyntaxKey.getState(state).caret;
  const boundary = delimiterBoundary(state, $from);
  const moveTo = ($pos, next, offset) => selectDelimiterPosition(view, $pos, next, offset);
  if (boundary) {
    const offset = (caret?.offset ?? boundary.defaultOffset) + direction;
    if (offset >= 0 && offset <= boundary.text.length) return moveTo($from, boundary, offset);
  }

  const adjacent = direction < 0 ? $from.nodeBefore : $from.nodeAfter;
  if (adjacent?.isText) {
    const { text } = adjacent;
    const character =
      graphemes?.segment(text).containing(direction < 0 ? text.length - 1 : 0).segment ??
      Array.from(text).at(direction < 0 ? -1 : 0);
    const size = character.length;
    const $next = state.doc.resolve($from.pos + direction * size);
    const next = delimiterBoundary(state, $next);
    if (next || boundary || adjacent.marks.length)
      return moveTo($next, next, direction < 0 ? next?.text.length : 0);
  } else if (!adjacent) {
    const edge = direction < 0 ? $from.before() : $from.after();
    const selection = TextSelection.findFrom(state.doc.resolve(edge), direction);
    if (selection instanceof TextSelection) {
      const next = delimiterBoundary(state, selection.$from);
      if (next || caret)
        return moveTo(selection.$from, next, direction < 0 ? next?.text.length : 0);
    }
  }
  return false;
}

const serializeInline = (serialize, schema, content) =>
  serialize(schema.topNodeType.create(null, schema.nodes.paragraph.create(null, content))).replace(
    /\r?\n$/,
    '',
  );

// 行内公式的两个 `$` 不在文档里，是画出来的：光标切在它们中间那一格时，退格/删除吃掉的是
// 正文最后一个字或者公式外面的字，那两枚定界符怎么都删不掉——初次打出来的那对能删，正因为
// 它还摊在文档里（见 mathDraftRange）。所以这一键不删字符，先把整条公式落成字面文本，摊成
// 和成对手势一样的草稿：草稿的 `$` 是真字符，同样的按键再走一下就正常删掉，光标一走开又折回
// 公式。不照粗体那样直接拆 mark：交回 remark 的是裸 LaTeX，写回文件少两个 `$`。
// 由公式预览插件排在「贴在边上那一下先掀源码」之后调用：源码还没露出来就谈不上删定界符。
export function unfoldMathPair(view, forward) {
  const { state } = view;
  const { empty, $from } = state.selection;
  if (!empty || !$from.parent.isTextblock || $from.parent.type.spec.code) return false;
  const boundary = delimiterBoundary(state, $from);
  if (!boundary) return false;
  // 文档位置只有一个，光标切在第几格由插件状态记着；没走过定界符就按默认那一格算。
  const offset = liveSyntaxKey.getState(state).caret?.offset ?? boundary.defaultOffset;
  const index = forward ? offset : offset - 1;
  if (index < 0 || index >= boundary.text.length) return false;
  let start = 0;
  for (const part of boundary.parts) {
    const end = start + part.text.length;
    if (index < end) {
      if (part.mark?.type.name !== mathMarkName) return false;
      const [prefix, suffix] = markDelimiters(part.mark, state.doc.textBetween(part.from, part.to));
      // 公式还挂在粗体这类标记里时，定界符跟着正文一起留下那几层，摊开再折回去才不会丢样式。
      const shared = (state.doc.resolve(part.from).nodeAfter?.marks || []).filter(
        (mark) => !mark.eq(part.mark),
      );
      const tr = closeHistory(state.tr)
        .removeMark(part.from, part.to, part.mark)
        .insertText(suffix, part.to, part.to, shared)
        .insertText(prefix, part.from, part.from, shared);
      // 定界符落在文档里原来那一格，光标原地不动，下一键删的就是它。左半边那枚先插进去，
      // 右半边的坐标要跟着挪一位。
      const caret = (part.opens ? part.from : part.to + prefix.length) + offset - start;
      view.dispatch(tr.setSelection(TextSelection.create(tr.doc, caret)).scrollIntoView());
      return true;
    }
    start = end;
  }
  return false;
}

function deleteDelimiter(ctx, view, event) {
  if (event.key !== 'Backspace' && event.key !== 'Delete') return false;
  if (
    !view.editable ||
    view.composing ||
    isImeComposing(event) ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey ||
    event.target.closest?.('.cm-editor, input, textarea, button, select')
  )
    return false;
  const { state } = view;
  const { selection, schema } = state;
  const { $from } = selection;
  if (!selection.empty || !$from.parent.isTextblock || $from.parent.type.spec.code) return false;

  const forward = event.key === 'Delete';
  const target = adjacentVisibleDelimiter(state, $from, forward);
  const range = target?.part;
  // The formula plugin preserves math delimiters by unfolding them into a draft.
  if (range?.mark?.type.name === mathMarkName) return false;
  const preference = activeMarkdownPairs(useConfigStore.getState());
  if (!range?.mark) {
    let text = '';
    $from.parent.forEach((node) => {
      text +=
        node.isText && !node.marks.some((mark) => mark.type.spec.code)
          ? node.text
          : '\ufffc'.repeat(node.nodeSize);
    });
    const symbol = text[$from.parentOffset - Number(!forward)];
    if (!markdownPairEnabled(preference, symbol)) return false;
    const pair = markdownPairDeletion(text, $from.parentOffset, event.key);
    if (!pair) return false;
    const tr = closeHistory(state.tr);
    const start = $from.start();
    for (const part of [...pair].reverse()) tr.delete(start + part.from, start + part.to);
    event.preventDefault();
    view.dispatch(tr.scrollIntoView());
    return true;
  }

  const [prefix, suffix] = markDelimiters(
    range.mark,
    state.doc.textBetween(range.from, range.to),
  );
  const paired = markdownPairEnabled(preference, prefix[0]) &&
    (range.mark.type.name !== 'inlineCode' || range.text[target.index] === '`');
  if (paired && (range.mark.type.name !== 'inlineCode' || prefix === '`')) {
    const tr = closeHistory(state.tr).removeMark(range.from, range.to, range.mark);
    if (range.mark.type.name === 'strong') {
      tr.addMark(
        range.from,
        range.to,
        schema.marks.emphasis.create({ marker: range.mark.attrs.marker }),
      );
    }
    tr.setSelection(TextSelection.create(tr.doc, $from.pos)).setStoredMarks([]);
    event.preventDefault();
    view.dispatch(tr.scrollIntoView());
    return true;
  }

  const content = state.doc.slice(range.from, range.to).content;
  let shared = content.firstChild.marks.filter((mark) => !mark.eq(range.mark));
  content.forEach((child) => {
    shared = shared.filter((mark) => mark.isInSet(child.marks));
  });
  const bodyNodes = [];
  content.forEach((child) =>
    bodyNodes.push(
      child.mark(child.marks.filter((mark) => !mark.eq(range.mark) && !mark.isInSet(shared))),
    ),
  );
  const body = range.mark.type.spec.code
    ? state.doc.textBetween(range.from, range.to)
    : serializeInline(ctx.get(serializerCtx), schema, Fragment.fromArray(bodyNodes));
  const source = prefix + body + suffix;
  const index = target.index + (range.opens ? 0 : prefix.length + body.length);
  const next = paired
    ? `${prefix.replace('`', '')}${body}${suffix.replace(/`(?=[^`]*$)/, '')}`
    : source.slice(0, index) + source.slice(index + 1);
  const tr = closeHistory(state.tr).replaceWith(
    range.from,
    range.to,
    schema.nodes[sourceTypeName].create(null, schema.text(next), shared),
  );
  tr.setSelection(
    TextSelection.create(
      tr.doc,
      range.from + 1 + Math.min(next.length, paired && index > 0 ? index - 1 : index),
    ),
  );
  event.preventDefault();
  view.dispatch(tr.scrollIntoView());
  return true;
}

function markerWidget(position, text, side, { heading = false, offset, start } = {}) {
  return Decoration.widget(
    position,
    (view) => {
      const marker = view.dom.ownerDocument.createElement('span');
      marker.className = `moki-markdown-marker${heading ? ' moki-markdown-heading-marker' : ''}`;
      marker.setAttribute('aria-hidden', 'true');
      marker.dataset.mokiMarker = text;
      marker.dataset.markerSide = String(side);
      if (start !== undefined) marker.dataset.markerStart = String(start);
      if (offset !== undefined) {
        marker.classList.add('moki-markdown-marker--with-caret');
        marker.dataset.markerBefore = text.slice(0, offset);
        marker.dataset.markerAfter = text.slice(offset);
        marker.append(view.dom.ownerDocument.createElement('i'));
      }
      return marker;
    },
    {
      side,
      marks: [],
      ignoreForCoords: true,
      key: `markdown-marker:${side}:${text}:${offset ?? ''}:${start ?? ''}:${heading}`,
    },
  );
}

function boundaryMarkers(position, boundary, offset, revealMark) {
  const markers = [];
  let end = 0;
  let widgetBeforeCaret = false;
  for (const { mark, text } of boundary.parts) {
    const start = end;
    end += text.length;
    if (mark && !revealMark(mark)) continue;
    const inside = start < offset && offset < end;
    const side = end <= offset || inside ? -1 : 1;
    widgetBeforeCaret ||= side < 0;
    markers.push(markerWidget(position, text, side, {
      heading: !mark, start, offset: inside ? offset - start : undefined,
    }));
  }
  if (!widgetBeforeCaret && boundary.closingLength && offset >= boundary.closingLength) {
    // With a collapsed closing delimiter, keep the DOM selection outside the
    // preceding style span without drawing an additional caret.
    markers.unshift(Decoration.widget(position, (view) => {
      const edge = view.dom.ownerDocument.createElement('span');
      edge.className = 'moki-markdown-native-edge';
      edge.setAttribute('aria-hidden', 'true');
      return edge;
    }, { side: -1, marks: [], key: 'markdown-native-edge' }));
  }
  return markers;
}

function selectClickedDelimiter(view, event, marker) {
  const $pos = view.state.doc.resolve(view.posAtDOM(marker, 0));
  const boundary = delimiterBoundary(view.state, $pos);
  if (!boundary) return false;
  const box = marker.getBoundingClientRect();
  const length = marker.dataset.mokiMarker.length;
  const rtl = marker.ownerDocument.defaultView.getComputedStyle(marker).direction === 'rtl';
  const x = rtl ? box.right - event.clientX : event.clientX - box.left;
  const ratio = box.width ? x / box.width : 0;
  const start = marker.dataset.markerStart === undefined
    ? Number(marker.dataset.markerSide) < 0 ? boundary.text.length - length : 0
    : Number(marker.dataset.markerStart);
  const offset = start + Math.round(Math.max(0, Math.min(1, ratio)) * length);
  event.preventDefault();
  inlinePointerGestures.get(view)?.cancel();
  selectDelimiterPosition(view, $pos, boundary, offset, false, null);
  if (!view.hasFocus()) view.focus();
  return true;
}

function marksOutsideInlineBoundary($pos) {
  if (!$pos.parent.isTextblock || $pos.parent.type.spec.code || $pos.textOffset) return null;
  const before = $pos.nodeBefore?.marks ?? [];
  const after = $pos.nodeAfter?.marks ?? [];
  const marks = $pos.marks();
  const outside = marks.filter((mark) =>
    !markDelimiters(mark, '') || (mark.isInSet(before) && mark.isInSet(after)),
  );
  return outside.length === marks.length ? null : outside;
}

function inlineTextHit(view, inline, { clientX, clientY }) {
  if (!inline) return null;
  const doc = inline.ownerDocument;
  const range = doc.createRange();
  const textNodes = doc.createTreeWalker(inline, NodeFilter.SHOW_TEXT);
  for (let node = textNodes.nextNode(); node; node = textNodes.nextNode()) {
    if (!node.length || node.parentElement?.closest('.ProseMirror-widget')) continue;
    range.selectNodeContents(node);
    for (const { left, right, top, bottom } of range.getClientRects()) {
      if (clientX >= left && clientX <= right && clientY >= top && clientY < bottom) {
        return { from: view.posAtDOM(node, 0), to: view.posAtDOM(node, node.length) };
      }
    }
  }
  return null;
}

function inlineGapHit(view, block, selector, { clientX, clientY }) {
  if (!block) return null;
  const range = block.ownerDocument.createRange();
  for (const inline of block.querySelectorAll(selector)) {
    const boxes = inline.getClientRects();
    for (const before of [true, false]) {
      let text = before ? inline.previousSibling : inline.nextSibling;
      while (text?.classList?.contains('moki-markdown-native-edge')) {
        text = before ? text.previousSibling : text.nextSibling;
      }
      if (text?.nodeType !== Node.TEXT_NODE) continue;
      // A single separator shares the click area with the adjacent style's margin.
      // Leave longer, intentionally spaced runs to normal text hit testing.
      const separator = before ? /(?:^|[^ \u00a0])[ \u00a0]$/ : /^[ \u00a0](?![ \u00a0])/;
      if (!separator.test(text.data)) continue;
      const offset = before ? text.length - 1 : 0;
      const box = boxes[before ? 0 : boxes.length - 1];
      if (!box || clientY < box.top || clientY >= box.bottom) continue;
      range.setStart(text, offset);
      range.setEnd(text, offset + 1);
      for (const space of range.getClientRects()) {
        if (!space.width || clientY < space.top || clientY >= space.bottom) continue;
        const edge = space.left + space.right < box.left + box.right ? box.left : box.right;
        if (clientX < Math.min(space.left, edge) || clientX > Math.max(space.right, edge)) continue;
        const from = view.posAtDOM(text, offset);
        const to = view.posAtDOM(text, offset + 1);
        return { from, to, position: before ? to : from };
      }
    }
  }
  return null;
}

function nativeSelectionIsCommitted(view) {
  const { doc, selection } = view.state;
  if (!(selection instanceof TextSelection) || !view.hasFocus() || !view.dom.ownerDocument.hasFocus()) return true;
  const native = view.root.getSelection?.() ?? view.dom.ownerDocument.getSelection();
  if (!native || !view.dom.contains(native.anchorNode) || !view.dom.contains(native.focusNode)) return true;
  const anchor = view.posAtDOM(native.anchorNode, native.anchorOffset, 1);
  const head = view.posAtDOM(native.focusNode, native.focusOffset, 1);
  if (selection.anchor === anchor && selection.head === head) return true;
  const $anchor = doc.resolve(anchor);
  const $head = doc.resolve(head);
  return (!$anchor.parent.inlineContent || !$head.parent.inlineContent) &&
    TextSelection.between($anchor, $head, 1).eq(selection);
}

function beginInlinePointerGesture(view, event, inline, gap) {
  const { selection, storedMarks } = view.state;
  const doc = view.dom.ownerDocument;
  const window = doc.defaultView;
  const mathElement = event.target.closest?.('[data-moki-math-mark]');
  const mathFrom = mathElement && view.posAtDOM(mathElement, 0);
  const mathTo = mathElement && view.posAtDOM(mathElement, mathElement.childNodes.length);
  // Capture the side of real text before the decorations can change the layout.
  const textHit = mathElement ? null : inlineTextHit(view, inline, event);
  const pointer = {
    selection,
    caret: liveSyntaxKey.getState(view.state).caret,
    marks: storedMarks ?? selection.$from.marks(),
    focused: view.hasFocus(),
  };
  const listeners = new AbortController();
  const { signal } = listeners;
  let frame = 0;
  let released = false;
  let clicked = false;
  const cancel = () => {
    listeners.abort();
    if (frame) window.cancelAnimationFrame(frame);
    inlinePointerGestures.delete(view);
  };
  const finish = () => {
    if (!released) return;
    if (view.isDestroyed || liveSyntaxKey.getState(view.state).pointer !== pointer) {
      cancel();
      return;
    }
    // A presentation update must not paint an old PM selection over a newer DOM selection.
    if (!nativeSelectionIsCommitted(view)) return;
    cancel();
    const { state } = view;
    let { $cursor } = state.selection;
    const tr = state.tr;
    let math = null;
    if (clicked && view.hasFocus() && $cursor) {
      if (gap && $cursor.pos >= gap.from && $cursor.pos <= gap.to && $cursor.pos !== gap.position) {
        // Resolve this explicit gap hit while the caret is still hidden.
        // The document keeps the separator and keyboard navigation can still enter it.
        tr.setSelection(TextSelection.create(tr.doc, gap.position));
        $cursor = tr.selection.$cursor;
      }
      const range = mathElement && [...activeMarkRanges($cursor), ...activeMarkRanges($cursor, -1)]
        .find(({ mark, from, to }) => mark.type.name === mathMarkName && from <= mathFrom && to >= mathTo);
      if (range) {
        math = { from: range.from, to: range.to, inspect: true };
        const marks = $cursor.pos === range.to ? $cursor.nodeBefore?.marks : $cursor.nodeAfter?.marks;
        if (marks) tr.setStoredMarks(marks);
      } else {
        const edge = $cursor.pos === textHit?.from
          ? $cursor.nodeAfter
          : $cursor.pos === textHit?.to
            ? $cursor.nodeBefore
            : null;
        const marks = edge?.marks ?? marksOutsideInlineBoundary($cursor);
        if (marks || state.storedMarks) tr.setStoredMarks(marks);
      }
    }
    view.dispatch(tr.setMeta(liveSyntaxKey, { pointer: null, math }));
  };
  const schedule = () => {
    if (liveSyntaxKey.getState(view.state).pointer !== pointer) {
      cancel();
      return;
    }
    if (!released || frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      finish();
    });
  };
  const moved = (point) =>
    Math.hypot(point.clientX - event.clientX, point.clientY - event.clientY) > 4;
  let dragged = false;
  inlinePointerGestures.get(view)?.cancel();
  inlinePointerGestures.set(view, { cancel, finish, schedule });
  window.addEventListener('mousemove', (move) => { dragged ||= moved(move); }, { capture: true, signal });
  window.addEventListener('mouseup', (up) => {
    if (up.button !== 0) return;
    clicked = !dragged && !moved(up) && view.dom.contains(up.target);
    released = true;
    schedule();
  }, { capture: true, signal });
  const releaseWithoutClick = () => {
    clicked = false;
    released = true;
    finish();
    schedule();
  };
  window.addEventListener('dragend', releaseWithoutClick, { capture: true, signal });
  window.addEventListener('pointercancel', releaseWithoutClick, { capture: true, signal });
  window.addEventListener('blur', releaseWithoutClick, { signal });
  doc.addEventListener('selectionchange', schedule, { signal });
  view.dispatch(view.state.tr.setMeta(liveSyntaxKey, { pointer }));
}

function handleInlinePointer(view, event) {
  const target = event.target;
  if (
    !view.editable ||
    view.composing ||
    event.detail !== 1 ||
    event.shiftKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    target.closest?.('a, button, input, textarea, select, .cm-editor')
  )
    return false;

  const marker = target.closest?.('.moki-markdown-marker');
  if (marker) return selectClickedDelimiter(view, event, marker);
  const inlineSelector = 'strong, b, em, i, del, s, code, [data-moki-math-mark]';
  const inline = target.closest?.(inlineSelector);
  const block = target.closest?.('p, h1, h2, h3, h4, h5, h6, td, th');
  if (inline || block?.querySelector(inlineSelector) ||
      view.dom.querySelector('.moki-markdown-marker, .moki-math-source')) {
    const gap = !inline && inlineGapHit(view, block, inlineSelector, event);
    beginInlinePointerGesture(view, event, inline, gap);
  }
  return false;
}

function alignVirtualCaret(view) {
  if (!view.dom.classList.contains('moki-markdown-virtual-caret')) return;
  const cursor = view.dom.querySelector('.moki-markdown-marker--with-caret i');
  if (!cursor) return;
  const anchor = cursor.getBoundingClientRect();
  if (!anchor.height) return;
  const { $head } = view.state.selection;
  const middle = (anchor.top + anchor.bottom) / 2;
  let { top, bottom } = anchor;
  for (const side of [1, -1]) {
    const text = side > 0 ? $head.nodeAfter : $head.nodeBefore;
    if (!text?.isText) continue;
    // Sample the adjoining text on this line, past any widgets at the selection.
    const rect = view.coordsAtPos($head.pos + side, -side);
    if (rect.bottom <= rect.top || middle < rect.top || middle > rect.bottom) continue;
    ({ top, bottom } = rect);
    break;
  }
  cursor.style.setProperty('--moki-caret-top', `${top - anchor.top}px`);
  cursor.style.setProperty('--moki-caret-height', `${bottom - top}px`);
}

function pendingMarkers($caret) {
  const before = $caret.nodeBefore;
  if (!before?.isText || before.marks.length) return [];
  const text = before.text.slice(-2048);
  const start = $caret.pos - text.length;
  const ghost = (from, to) =>
    Decoration.inline(start + from, start + to, { class: 'moki-markdown-ghost' });
  const after = $caret.nodeAfter;
  // 成对草稿的那两枚 `$` 由预览插件负责染透明，这里再抹一层灰就是两个插件抢同一段字。
  const draft = mathDraftAt($caret);
  const isDraftMarker = (from, to) =>
    !!draft && to - from === 1 && (from === draft.anchor || from === draft.close);
  if (after?.isText && !after.marks.length) {
    const width = emptyAsteriskPair(text + after.text.slice(0, 3), text.length);
    if (width) return [ghost(text.length - width, text.length + width)];
  }
  if ($caret.parent.type.name === 'paragraph' && start === $caret.start()) {
    const prefix = /^( {0,3})(#{1,6}|>+|[-+*]|\d{1,9}[.)]|`{3,}|~{3,})(?=$|[ \t])/.exec(text);
    if (prefix) return [ghost(prefix[1].length, prefix[0].length)];
  }

  for (const match of text.matchAll(/\*+|_+|~+|`+|\$+|!?\[/g)) {
    const token = match[0];
    const from = match.index;
    const to = from + token.length;
    if (isDraftMarker(start + from, start + to)) continue;
    if (from && /[\w:/\\]/.test(text[from - 1])) continue;
    const rest = text.slice(to);
    if (/^\s/.test(rest) || (token === '$' && /^\d/.test(rest))) continue;
    if (token.endsWith('[')) {
      if (/\]\([^)]*\)$/.test(rest)) continue;
      const address = rest.indexOf('](');
      return address < 0
        ? [ghost(from, to)]
        : [ghost(from, to), ghost(to + address, to + address + 2)];
    }
    if (rest.includes(token)) continue;
    const partialClose = token.length > 1 ? rest.match(/([*_~`])\1*$/)?.[0] : null;
    return partialClose && token.startsWith(partialClose)
      ? [ghost(from, to), ghost(text.length - partialClose.length, text.length)]
      : [ghost(from, to)];
  }
  return [];
}

function pendingCodeFence(view) {
  const { selection } = view.state;
  const { $from } = selection;
  if (
    !view.editable ||
    !selection.empty ||
    $from.parent.type.name !== 'paragraph' ||
    $from.parentOffset !== $from.parent.content.size ||
    $from.parent.childCount !== 1 ||
    !$from.parent.firstChild.isText ||
    $from.parent.firstChild.marks.length ||
    !markdownPairEnabled(activeMarkdownPairs(useConfigStore.getState()), '`')
  )
    return null;
  const fence = readMarkdownFence($from.parent.textContent);
  return fence && { ...fence, $from };
}

function openCodeFence(view, $pos, language, autoOpened = false) {
  const { state } = view;
  const type = state.schema.nodes.code_block;
  const pos = $pos.before();
  const parent = $pos.node(-1),
    index = $pos.index(-1);
  const code = type.create({ language });
  const replacement = parent.canReplaceWith(index, index + 1, type)
    ? Fragment.from(code)
    : Fragment.fromArray([state.schema.nodes.paragraph.create(), code]);
  if (!parent.canReplace(index, index + 1, replacement)) return false;
  const tr = closeHistory(state.tr).replaceWith(pos, $pos.after(), replacement);
  const codePos = pos + replacement.size - code.nodeSize;
  tr.setSelection(TextSelection.create(tr.doc, codePos + 1));
  view.dispatch(tr.scrollIntoView());
  const block = view.nodeDOM(codePos);
  // If ProseMirror did not focus the node view during dispatch, focus it now.
  if (!block?.contains(view.dom.ownerDocument.activeElement)) view.focus();
  if (autoOpened && block) autoOpenedFences.add(block);
  return true;
}

function typeBacktick(view, $pos, value) {
  const { state } = view;
  const leftMarks = $pos.nodeBefore?.marks || [];
  const rightCode = $pos.nodeAfter?.marks.some((mark) => mark.type.spec.code);
  const currentMarks = state.storedMarks ?? leftMarks;
  if (currentMarks.some((mark) => mark.type.spec.code) && !rightCode) {
    view.dispatch(state.tr.setStoredMarks(currentMarks.filter((mark) => !mark.type.spec.code)));
    return true;
  }
  if (leftMarks.some((mark) => mark.type.spec.code) || rightCode) return false;
  const action = markdownBacktickEdit(value, $pos.parentOffset);
  if (!action) return false;
  const tr = closeHistory(state.tr);
  if (action.kind !== 'skip') tr.insertText('`', $pos.pos);
  const position = $pos.pos + (action.kind === 'fence' ? 2 : Number(action.kind === 'skip'));
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, position)).scrollIntoView());
  return true;
}

const bracketKeys = new Set([...markdownBrackets.keys(), ...markdownBrackets.values()]);

function asteriskWidth(mark) {
  if (mark.attrs.marker !== '*') return 0;
  return mark.type.name === 'strong' ? 2 : Number(mark.type.name === 'emphasis');
}

function completeClosedAsterisk(view, $pos, value) {
  const { state } = view;
  const offset = $pos.parentOffset;
  if (value.length !== $pos.parent.content.size) return false;
  const next = value.slice(0, offset) + '*' + value.slice(offset);
  const pair = markdownPairDeletion(next, offset + 1, 'Backspace');
  if (!pair) return false;
  const [opening, closing] = pair;
  const start = opening.from - 1,
    end = closing.from + 2;
  if (
    next.slice(start, opening.to) !== '**' ||
    next.slice(closing.from, end) !== '**' ||
    next[start - 1] === '*' ||
    next[end] === '*' ||
    opening.to >= closing.from
  )
    return false;
  const type = state.schema.marks.strong;
  if (!type) return false;
  const mark = type.create({ marker: '*' });
  const from = $pos.start();
  const tr = closeHistory(state.tr).insertText('*', $pos.pos);
  // Remove just the delimiters, leaving existing inline marks and surrounding text intact.
  tr.delete(from + closing.from, from + end).delete(from + start, from + opening.to);
  const contentEnd = from + closing.from - 2;
  tr.addMark(from + start, contentEnd, mark);
  const opens = offset < opening.to;
  tr.setSelection(TextSelection.create(tr.doc, opens ? from + start : contentEnd));
  if (!opens) tr.setStoredMarks(mark.removeFromSet(tr.selection.$from.marks()));
  view.dispatch(tr.scrollIntoView());
  return true;
}

function typeAsterisk(view, $pos, value, text) {
  const { state } = view;
  const marks = state.storedMarks ?? $pos.marks();
  if (
    marks.some((mark) => mark.type.spec.code) ||
    $pos.nodeAfter?.marks.some((mark) => mark.type.spec.code)
  )
    return false;
  if (text === '*') {
    const after = $pos.nodeAfter?.marks || [];
    const ending = marks.find(
      (mark) =>
        asteriskWidth(mark) && !mark.isInSet(after) && mark.isInSet($pos.nodeBefore?.marks || []),
    );
    if (ending) {
      const tr = state.tr;
      if (asteriskWidth(ending) === 2 && !liveSyntaxKey.getState(state).closing)
        tr.setMeta(liveSyntaxKey, { closing: true });
      else tr.setStoredMarks(ending.removeFromSet(marks));
      view.dispatch(tr);
      return true;
    }
    const offset = $pos.parentOffset;
    const edit = markdownAsteriskEdit(value, offset);
    if (!edit) return false;
    // In front of existing text, or after its last character, the second star
    // extends the delimiter instead of inserting an empty pair.
    const left = value[offset - 2] || '',
      right = value[offset] || '';
    if (
      edit.text === '*' &&
      edit.advance === 0 &&
      (/[^\s\p{Ps}\p{Pi}]/u.test(left) ||
        (/\S/u.test(right) && markdownBrackets.get(left) !== right))
    )
      return false;
    const tr = closeHistory(state.tr);
    if (edit.text) tr.insertText(edit.text, $pos.pos);
    view.dispatch(
      tr.setSelection(TextSelection.create(tr.doc, $pos.pos + edit.advance)).scrollIntoView(),
    );
    return true;
  }
  if (
    /^[\t \u00a0]$/.test(text) &&
    $pos.parent.type.name === 'paragraph' &&
    /^ {0,3}\*{4}$/.test(value) &&
    emptyAsteriskPair(value, $pos.parentOffset) === 2
  ) {
    // The third typed asterisk also starts the existing thematic break shortcut.
    const type = state.schema.nodes.hr;
    const index = $pos.index(-1);
    if ($pos.node(-1).canReplaceWith(index, index + 1, type)) {
      view.dispatch(
        closeHistory(state.tr)
          .replaceWith($pos.before(), $pos.after(), type.create())
          .scrollIntoView(),
      );
      return true;
    }
  }
  return false;
}

// 打 `\$` 想要的是普通文字里的 `$`：把前面那个反斜杠吃掉，换成和文件里 `\$` 读进来
// 一样的形状（挂转义 mark 的 `$`），扫描据此不再把它当定界符，见 syntaxScanText。
// 公式正文与代码里不适用：`$` 在正文里是收界符，remark-math 也写不出转义的 `$`；
// 还没闭合的 `$$` 草稿里则照旧留给草稿判定，别把用户正在写的 LaTeX 搅了。
function typeEscapeDollar(view, $pos, value, text) {
  const { state } = view;
  if (text !== '$') return false;
  const type = state.schema.marks[characterEscapeMarkName];
  if (!type) return false;
  const marks = state.storedMarks ?? $pos.marks();
  if (marks.some((mark) => mark.type.spec.code)) return false;
  let back = 0;
  while (value[$pos.parentOffset - back - 1] === '\\') back++;
  if (!(back % 2) || mathDraftRange(value, $pos.parentOffset)) return false;
  const tr = state.tr.replaceWith($pos.pos - 1, $pos.pos,
    state.schema.text('$', [...$pos.nodeBefore.marks, type.create()]));
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, $pos.pos)).scrollIntoView());
  return true;
}

// 行首连打三下 `$` 是块级公式的成对手势，与 `*` 两下成斜体、第三下升成粗体同一条路子。
// 判据与 `$$ ` 那条输入规则对齐：空对独占整段、光标正踩在收尾那枚上，才把整段换成可编辑
// 的公式源码块。行中还挂着别的字（`正文 $|$`）时，第三下说的仍是「这条行内公式写完了」，
// 照旧只把光标递到定界符外面。
function openMathBlockPair(view, $pos, value, draft) {
  if (
    !draft ||
    draft.anchor ||
    draft.from !== draft.to ||
    draft.close !== $pos.parentOffset ||
    draft.close !== value.length - 1
  )
    return false;
  const { state } = view;
  const type = state.schema.nodes.math_source_block;
  if (!type || !$pos.node(-1).canReplaceWith($pos.index(-1), $pos.indexAfter(-1), type))
    return false;
  const from = $pos.before();
  const tr = closeHistory(state.tr).replaceWith(from, $pos.after(), type.create());
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from + 1)).scrollIntoView());
  return true;
}

// 打字判定只看向刚敲下的这个字符：`$` 要么收尾已有公式，要么把之前打下的字面 `$`
// 连同中间的正文一起折成 math mark，两个定界符都不留在文档里；成对手势打出的那对 `$`
// 先以字面文本摊着（见 mathDraftRange），光标离开这一段才折。
// 判据照抄 pendingMarkers 对 `$` 的保护（数字开头是价格、转义的是正文），
// 让打字看到的样子和折叠的结果一致。
function typeDollar(view, $pos, value, text, preference) {
  if (text !== '$') return false;
  const { state } = view;
  const type = state.schema.marks.math;
  if (!type) return false;
  const marks = state.storedMarks ?? $pos.marks();
  // 光标在公式正文里：把 mark 收到 caret 为止，后面的正文退回普通文字。
  // 直接留个字面 $ 在正文里不行——remark-math 里 $ 没法转义，写回去会变成两段公式。
  if (type.isInSet(marks)) {
    const range = activeMarkRanges($pos).find((item) => item.mark.type === type);
    if (!range) return false;
    const tr = closeHistory(state.tr);
    if (range.to > $pos.pos) tr.removeMark($pos.pos, range.to, type);
    view.dispatch(tr.setStoredMarks(type.removeFromSet(marks)));
    return true;
  }
  // inclusive:false 让公式右边界的 marks() 早就摘掉了 math，只能看文档两侧。
  const left = $pos.nodeBefore?.marks || [];
  const right = $pos.nodeAfter?.marks || [];
  if (!$pos.textOffset && type.isInSet(left) && !type.isInSet(right)) {
    view.dispatch(state.tr.setStoredMarks(type.removeFromSet(marks)));
    return true;
  }
  if (marks.some((mark) => mark.type.spec.code) || right.some((mark) => mark.type.spec.code)) return false;
  const offset = $pos.parentOffset;
  // 「公式」这一项管成对手势那两下：补出右半截把光标放进中间，以及行首第三下升级成块级
  // 公式。关掉之后 `$` 就是一枚普通字符，`$$ ` 也凑不出空对，块级入口自然跟着关。
  // 已经写好的 `$x^2$` 收尾即折不归这项——那是公式预览的活，不是配对补全。
  const paired = markdownPairEnabled(preference, '$');
  // 贴在草稿的收尾 `$` 前面再打 `$`，是老手感里「$$x$$ 写完了」的那一下：这一笔不吃正文
  // 也不另开一对，只把光标递到定界符外面。光标已经离开那一段，预览插件紧接着折成公式。
  const draft = mathDraftRange(value, offset);
  if (paired && openMathBlockPair(view, $pos, value, draft)) return true;
  const atClose =
    value[offset] === '$' &&
    (draft?.close === offset ||
      (value[offset - 1] === '$' &&
        value[offset - 2] !== '$' &&
        !(offset > 1 && /[\w:/\\]/.test(value[offset - 2]))));
  if (atClose) {
    view.dispatch(
      closeHistory(state.tr).setSelection(TextSelection.create(state.doc, $pos.pos + 1)),
    );
    return true;
  }
  // 成对手势的第二下：`$` 紧跟在另一枚 `$` 后面时补出右半截，光标留在两枚中间，
  // 与 `**` 同一套手感——紧接着打的字才算公式正文，那两枚定界符由预览插件染透明、
  // 光标一走就折掉。连写的第三枚、贴着字母数字的那一枚都不算开界，与 mathDraftRange 同源。
  if (
    paired &&
    value[offset - 1] === '$' &&
    value[offset - 2] !== '$' &&
    !/[^\s]/.test(value[offset] || '') &&
    !(offset > 1 && /[\w:/\\]/.test(value[offset - 2]))
  ) {
    const tr = closeHistory(state.tr).insertText('$', $pos.pos);
    view.dispatch(
      tr.setSelection(TextSelection.create(tr.doc, $pos.pos)).scrollIntoView(),
    );
    return true;
  }
  for (let index = offset - 1; index >= 0; index--) {
    if (value[index] !== '$') continue;
    // 连写的 `$` 归草稿判定管，不能拿半截去折一个单 `$` 公式。
    if (value[index - 1] === '$') return false;
    let escaped = 0;
    for (let back = index - 1; back >= 0 && value[back] === '\\'; back--) escaped++;
    if (escaped % 2) continue;
    const body = value.slice(index + 1, offset);
    // 正文跨了 inline 子节点或占位符就交给默认插入，折叠只负责单个文本节点里的 LaTeX。
    if (!body || /^[\s\r\n]|\s$|[\n\ufffc]/.test(body) || /^\d/.test(body)) return false;
    if (index > 0 && /[\w:/\\]/.test(value[index - 1])) return false;
    const from = $pos.pos - body.length - 1;
    const tr = closeHistory(state.tr);
    tr.delete(from, from + 1);
    tr.addMark(from, $pos.pos - 1, type.create());
    tr.setSelection(TextSelection.create(tr.doc, $pos.pos - 1));
    tr.setStoredMarks(type.removeFromSet(tr.selection.$from.marks()));
    view.dispatch(tr.scrollIntoView());
    return true;
  }
  return false;
}

function completeInlinePair(view, $pos, value, text, composition, paste = false) {
  const { state } = view;
  const offset = $pos.parentOffset;
  const symbol = value[offset];
  const width = emptyMarkdownMarkPair(value, offset);
  if (
    !width ||
    !text ||
    text === symbol ||
    /[\r\n]/.test(text) ||
    (symbol !== '`' && text.trim() !== text)
  )
    return false;
  const marks = state.storedMarks ?? $pos.marks();
  if (
    marks.some((mark) => mark.type.spec.code) ||
    $pos.nodeAfter?.marks.some((mark) => mark.type.spec.code)
  )
    return false;
  const type =
    state.schema.marks[
      symbol === '`'
        ? 'inlineCode'
        : symbol === '~'
          ? 'strike_through'
          : width === 2
            ? 'strong'
            : 'emphasis'
    ];
  if (!type) return false;
  const nextMarks = type.create({ marker: symbol }).addToSet(marks);
  const from = $pos.pos - width;
  // The IME has already inserted its committed text; ordinary typing hasn't.
  const insertedLength = composition?.length ?? 0;
  const tr = composition ? state.tr : closeHistory(state.tr);
  if (paste) tr.setMeta('paste', true).setMeta('uiEvent', 'paste');
  if (composition?.id) tr.setMeta('composition', composition.id);
  tr.replaceWith(from, $pos.pos + insertedLength + width, state.schema.text(text, nextMarks));
  tr.setSelection(TextSelection.create(tr.doc, from + text.length)).setStoredMarks(nextMarks);
  view.dispatch(tr.scrollIntoView());
  return true;
}

export function completePastedInlinePair(view, text) {
  const { empty, $from } = view.state.selection;
  if (
    !view.editable ||
    view.composing ||
    !empty ||
    !$from.parent.isTextblock ||
    $from.parent.type.spec.code
  )
    return false;
  const value = $from.parent.textBetween(0, $from.parent.content.size, '\n', '\ufffc');
  return completeInlinePair(view, $from, value, text, undefined, true);
}

function handleSmartTextInput(view, from, to, text) {
  if (view.composing || from !== to) return false;
  const { state } = view;
  const $pos = state.doc.resolve(from);
  if (!$pos.parent.isTextblock || $pos.parent.type.spec.code) return false;
  const value = syntaxScanText($pos.parent);
  const preference = activeMarkdownPairs(useConfigStore.getState());
  if (markdownPairEnabled(preference, '`')) {
    if (text === '`') return typeBacktick(view, $pos, value);
    if (from === state.selection.from && pendingCodeFence(view)) {
      if (text === ' ') {
        // Keep Markdown whitespace instead of Chromium's trailing nonbreaking space.
        view.dispatch(state.tr.insertText(text, from, to).scrollIntoView());
        return true;
      }
      if (/^[\w+.#-]+$/.test(text)) {
        const next = readMarkdownFence(value + text);
        const language = next && completedFenceLanguage(next.language);
        if (language && openCodeFence(view, $pos, language, true)) return true;
      }
    }
  }
  if (
    text === '*' &&
    !(state.storedMarks ?? $pos.marks()).some((mark) => mark.type.spec.code) &&
    !$pos.nodeAfter?.marks.some((mark) => mark.type.spec.code) &&
    completeClosedAsterisk(view, $pos, value)
  )
    return true;
  if (markdownPairEnabled(preference, '*') && typeAsterisk(view, $pos, value, text)) return true;
  if (typeEscapeDollar(view, $pos, value, text)) return true;
  if (typeDollar(view, $pos, value, text, preference)) return true;
  if (completeInlinePair(view, $pos, value, text)) return true;
  // Explicitly exiting an inline mark takes precedence over DOM mark inheritance.
  if (
    text &&
    state.storedMarks &&
    (liveSyntaxKey.getState(state).caret ||
      $pos.nodeBefore?.marks.some(
        (mark) =>
          !mark.isInSet(state.storedMarks) &&
          !mark.isInSet($pos.nodeAfter?.marks || []) &&
          markDelimiters(mark, ''),
      ))
  ) {
    view.dispatch(state.tr.insertText(text, from, to).scrollIntoView());
    return true;
  }
  if (text.length !== 1 || !markdownPairEnabled(preference, text)) return false;
  const edit = matchingMarkdownBracket(value, $pos.parentOffset, text);
  if (!edit) return false;
  if (
    text === ')' &&
    !edit.text &&
    inlineLinkPattern.test(value.slice(0, $pos.parentOffset) + text)
  )
    return false;
  const tr = state.tr;
  if (edit.text) tr.insertText(edit.text, from);
  tr.setSelection(TextSelection.create(tr.doc, from + edit.advance));
  view.dispatch(tr.scrollIntoView());
  return true;
}

export const milkdownLiveSyntax = $prose((ctx) => new Plugin({
  key: liveSyntaxKey,
  state: {
    init: () => ({ closing: false, caret: null, composition: null, pointer: null }),
    apply(tr, previous, oldState) {
      const update = tr.getMeta(liveSyntaxKey);
      if (!update && !tr.docChanged && !tr.selectionSet && !tr.storedMarksSet) return previous;
      const caret = update ? update.caret ?? null
        : !tr.docChanged && !tr.getMeta('pointer') && tr.selection.eq(oldState.selection) ? previous.caret : null;
      return { closing: update?.closing || false, caret,
        composition: tr.getMeta('composition') ?? previous.composition,
        pointer: update && 'pointer' in update ? update.pointer : tr.docChanged ? null : previous.pointer };
    },
  },
  view(editorView) {
    let previous = '';
    const resize =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => alignVirtualCaret(editorView))
        : null;
    resize?.observe(editorView.dom);
    return {
      update(view) {
        inlinePointerGestures.get(view)?.schedule();
        alignVirtualCaret(view);
        const pending = pendingCodeFence(view);
        const key = pending && `${pending.$from.pos}:${pending.$from.parent.textContent}`;
        if (key === previous) return;
        previous = key;
        let detail = null;
        if (pending && view.hasFocus()) {
          const { doc } = view.state;
          const current = () => !view.isDestroyed && view.state.doc === doc && pendingCodeFence(view)?.$from.pos === pending.$from.pos;
          detail = {
            query: pending.language,
            scroller: markdownPopupScroller(view.dom),
            containsTarget: (target) => view.dom.contains(target),
            getAnchor: () => {
              if (!current()) return null;
              const { left } = view.coordsAtPos(pending.$from.start(), 1);
              const { top, bottom } = view.coordsAtPos(pending.$from.pos);
              return { left, top, bottom };
            },
            select: (language) => { if (current()) openCodeFence(view, view.state.selection.$from, language); },
            undo: () => { if (current()) undo(view.state, view.dispatch); },
            focus: () => { if (!view.isDestroyed) view.focus(); },
          };
        }
        view.dom.dispatchEvent(new CustomEvent(CODE_FENCE_LANGUAGE_EVENT, { bubbles: true, detail }));
      },
      destroy() {
        resize?.disconnect();
        inlinePointerGestures.get(editorView)?.cancel();
      },
    };
  },
  appendTransaction(transactions, _oldState, state) {
    if (!transactions.some((tr) => tr.docChanged)) {
      const { $cursor } = state.selection;
      if (!$cursor || state.storedMarks ||
          !transactions.some((tr) => tr.selectionSet && tr.getMeta('pointer'))) return null;
      const marks = marksOutsideInlineBoundary($cursor);
      return marks ? state.tr.setStoredMarks(marks) : null;
    }
    const { $from } = state.selection;
    const source = $from.parent;
    if (source.type.name !== sourceTypeName) return null;
    const parsed = ctx.get(parserCtx)(source.textContent);
    const paragraph = parsed.firstChild;
    if (parsed.childCount !== 1 || paragraph?.type.name !== 'paragraph'
      || serializeInline(ctx.get(serializerCtx), state.schema, paragraph.content) !== source.textContent) return null;
    const nodes = [];
    paragraph.forEach((child) => child.isInline && nodes.push(child.mark(
      source.marks.reduce((marks, mark) => mark.addToSet(marks), child.marks),
    )));
    const replacement = Fragment.fromArray(nodes);
    const prefix = paragraph.firstChild?.marks.map((mark) => markDelimiters(mark, paragraph.textContent)?.[0].length || 0)
      .reduce((total, length) => total + length, 0) || 0;
    const from = $from.before();
    const tr = state.tr.replaceWith(from, $from.after(), replacement);
    const offset = Math.max(0, Math.min(replacement.size, $from.parentOffset - prefix));
    return tr.setSelection(TextSelection.create(tr.doc, from + offset));
  },
  props: {
    attributes(state) {
      const { caret, pointer } = liveSyntaxKey.getState(state);
      if (pointer) return { class: 'moki-markdown-native-gesture' };
      const { empty, $from } = state.selection;
      return caret && empty && insideDelimiter(delimiterBoundary(state, $from), caret.offset)
        ? { class: 'moki-markdown-virtual-caret' }
        : {};
    },
    handleTextInput: handleSmartTextInput,
    handleDOMEvents: {
      compositionstart(view) {
        inlineCompositions.delete(view);
        const { empty, $from } = view.state.selection;
        if (!empty || !$from.parent.isTextblock || $from.parent.type.spec.code) return false;
        const value = $from.parent.textBetween(0, $from.parent.content.size, '\n', '\ufffc');
        if (emptyMarkdownMarkPair(value, $from.parentOffset)) {
          inlineCompositions.set(view, { $from, value, previousId: liveSyntaxKey.getState(view.state).composition });
        }
        return false;
      },
      compositionend(view) {
        const pending = inlineCompositions.get(view);
        inlineCompositions.delete(view);
        if (!pending) return false;
        // Let ProseMirror commit the browser's composition before changing marks.
        setTimeout(() => {
          if (view.isDestroyed || view.composing || !view.editable) return;
          const { $from: before, value, previousId } = pending;
          const { doc, selection } = view.state;
          if (!selection.empty || before.pos > doc.content.size) return;
          const $pos = doc.resolve(before.pos);
          const offset = before.parentOffset;
          const length = $pos.parent.content.size - before.parent.content.size;
          if (length <= 0 || selection.from !== before.pos + length
            || $pos.parent.type !== before.parent.type || $pos.parentOffset !== offset
            || !$pos.parent.content.cut(0, offset).eq(before.parent.content.cut(0, offset))
            || !$pos.parent.content.cut(offset + length).eq(before.parent.content.cut(offset))) return;
          const text = $pos.parent.textBetween(offset, offset + length);
          const id = liveSyntaxKey.getState(view.state).composition;
          // Keep the conversion in the same undo group even if the IME
          // candidate was visible for longer than the normal history delay.
          if (text.length === length) completeInlinePair(view, $pos, value, text, { length, id: id !== previousId ? id : null });
        }, 0);
        return false;
      },
      keydown(view, event) {
        inlinePointerGestures.get(view)?.finish();
        if (view.editable && !view.composing && !isImeComposing(event)
          && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.closest?.('.cm-editor, input, textarea, button')
          && view.state.selection.empty) {
          const { from, to } = view.state.selection;
          if (!event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
            && moveAcrossDelimiters(view, event.key === 'ArrowLeft' ? -1 : 1)) {
            event.preventDefault();
            return true;
          }
          const enter = event.key === 'Enter' && !event.shiftKey;
          const pending = (enter || event.key === ' ') && pendingCodeFence(view);
          const pairedKey = event.key === '`' || event.key === '*' || bracketKeys.has(event.key) || (event.key === ' ' && pending);
          if ((enter && pending && openCodeFence(view, pending.$from, pending.language))
            || (pairedKey && handleSmartTextInput(view, from, to, event.key))) {
            event.preventDefault();
            return true;
          }
        }
        return deleteDelimiter(ctx, view, event);
      },
      mousedown(view, event) {
        if (event.button === 0) return handleInlinePointer(view, event);
        if (event.button !== 2 || !event.target.closest?.('a[href]')) return false;
        // Focusing here would insert markers and move the link before the
        // media context menu receives the browser's contextmenu event.
        event.preventDefault();
        return true;
      },
      beforeinput(view) {
        inlinePointerGestures.get(view)?.finish();
        return false;
      },
    },
    decorations(state) {
      const { doc } = state;
      const { caret, pointer } = liveSyntaxKey.getState(state);
      if (pointer && !pointer.focused) return null;
      const selection = pointer?.selection || state.selection;
      const { $from } = selection;
      if (!$from.parent.isTextblock || $from.parent.type.spec.code) return null;
      if (!selection.empty) return null;
      const delimiterPosition = pointer ? pointer.caret : caret;
      const boundary = delimiterBoundary(state, $from, selection, delimiterPosition);
      const offset = delimiterPosition?.offset ?? boundary?.defaultOffset;
      const inside = insideDelimiter(boundary, offset);
      const marks = pointer?.marks ?? state.storedMarks ?? $from.marks();
      const revealMark = (mark) => revealsDelimiter(mark, marks, inside);
      const decorations = pendingMarkers($from);
      const opening = new Map(), closing = new Map();
      const ranges = editableRanges(state, selection, delimiterPosition, [
        ...activeMarkRanges($from),
        ...activeMarkRanges($from, -1).filter(({ to }) => to === $from.pos),
      ]).filter(({ from, to, mark }) => (from < $from.pos && $from.pos < to) || revealMark(mark));
      ranges.sort((a, b) => a.from - b.from || b.to - a.to || a.order - b.order);
      for (const { from, to, delimiters: [open, close] } of ranges) {
        opening.set(from, (opening.get(from) || '') + open);
        closing.set(to, close + (closing.get(to) || ''));
      }
      if ($from.parent.type.name === 'heading' && $from.parentOffset === 0) {
        decorations.push(Decoration.node($from.before(), $from.after(), { class: 'moki-markdown-heading-source' }));
      }
      if (boundary) {
        opening.delete($from.pos);
        closing.delete($from.pos);
        decorations.push(...boundaryMarkers($from.pos, boundary, offset, revealMark));
      }
      for (const [pos, text] of opening) decorations.push(markerWidget(pos, text, -1));
      for (const [pos, text] of closing) decorations.push(markerWidget(pos, text, 1));
      return decorations.length ? DecorationSet.create(doc, decorations) : null;
    },
  },
}));

export const milkdownBlockSelection = $prose(
  () =>
    new Plugin({
      props: {
        decorations({ doc, selection }) {
          if (selection.empty) return null;
          const { from, to } = selection,
            blocks = [];
          doc.nodesBetween(from, to, (node, pos) => {
            const end = pos + node.nodeSize;
            if (
              node.type.name === 'code_block' &&
              from <= pos + 1 &&
              to >= end - 1 &&
              (from <= pos || to >= end)
            ) {
              blocks.push(Decoration.node(pos, end, { class: 'moki-block-selected' }));
            }
            if (node.type.name !== 'blockquote') return;
            const first = TextSelection.findFrom(doc.resolve(pos + 1), 1, true);
            const last = TextSelection.findFrom(doc.resolve(end - 1), -1, true);
            if (
              (from <= pos && to >= end) ||
              (first &&
                last &&
                first.from < end &&
                last.to > pos &&
                from <= first.from &&
                to >= last.to)
            ) {
              blocks.push(Decoration.node(pos, end, { class: 'moki-block-selected' }));
            }
          });
          return blocks.length ? DecorationSet.create(doc, blocks) : null;
        },
      },
    }),
);

// Validate completed links and images with the same Markdown parser used to
// load documents. Input rules keep the conversion in the normal undo history.
export const milkdownInlineLinkRule = $inputRule(
  (ctx) =>
    new InputRule(inlineLinkPattern, (state, match, start, end) => {
      const paragraph = ctx.get(parserCtx)(match[0]).firstChild;
      if (!paragraph?.childCount || paragraph.type.name !== 'paragraph') return null;
      if (
        markdownPairEnabled(activeMarkdownPairs(useConfigStore.getState()), ')') &&
        state.doc.resolve(end).nodeAfter?.text?.startsWith(')')
      )
        end++;
      if (paragraph.childCount === 1 && paragraph.firstChild.type.name === 'image') {
        return state.tr.replaceWith(start, end, paragraph.content);
      }
      const link = paragraph.firstChild.marks.find((mark) => mark.type.name === 'link');
      if (!link) return null;
      let valid = true;
      paragraph.forEach((node) => {
        if (!link.isInSet(node.marks)) valid = false;
      });
      if (!valid) return null;
      const labelStart = start + 1,
        labelEnd = labelStart + match[1].length;
      const label = state.doc.slice(labelStart, labelEnd).content;
      let alreadyFormatted = false;
      label.forEach((node) => {
        if (!node.isText || node.marks.length) alreadyFormatted = true;
      });
      const tr = alreadyFormatted
        ? state.tr
            .delete(labelEnd, end)
            .delete(start, labelStart)
            .addMark(start, start + label.size, link)
        : state.tr.replaceWith(start, end, paragraph.content);
      return tr.setStoredMarks(state.storedMarks || []);
    }),
);
