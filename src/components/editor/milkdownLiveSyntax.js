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

const sourceTypeName = 'moki_inline_syntax_source';
const liveSyntaxKey = new PluginKey('moki-live-syntax');
const inlinePointerCleanup = new WeakMap();
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
      return clearFenceConfirmation(view) && event.key === 'Enter' && !event.repeat
        && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey
        && !view.composing && !isImeComposing(event) && view.state.doc.length === 0;
    },
    pointerdown(_event, view) { clearFenceConfirmation(view); },
    blur(_event, view) { clearFenceConfirmation(view); },
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
    case 'inlineCode': {
      let length = 1;
      for (const match of text.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
      const fence = '`'.repeat(length);
      const padding = /^`|`$|^ .* $/s.test(text) && /[^ ]/.test(text) ? ' ' : '';
      return [fence + padding, padding + fence];
    }
    case 'link': {
      const href = String(mark.attrs.href || '');
      const destination = /\s/.test(href) ? `<${href.replace(/>/g, '\\>')}>` : href.replace(/[()\\]/g, '\\$&');
      const title = mark.attrs.title ? ` "${mark.attrs.title.replace(/["\\]/g, '\\$&')}"` : '';
      return ['[', `](${destination}${title})`];
    }
    default: return null;
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
    let from = start, to = start + child.nodeSize;
    for (let i = index - 1; i >= 0 && mark.isInSet(parent.child(i).marks); i--) from -= parent.child(i).nodeSize;
    for (let i = index + 1; i < parent.childCount && mark.isInSet(parent.child(i).marks); i++) to += parent.child(i).nodeSize;
    const text = mark.type.spec.code ? parent.textBetween(from - $caret.start(), to - $caret.start()) : '';
    const delimiters = markDelimiters(mark, text);
    return delimiters ? [{ from, to, order, delimiters, mark }] : [];
  });
}

function delimiterBoundary($pos) {
  if (!$pos.parent.isTextblock || $pos.parent.type.spec.code || $pos.textOffset) return null;
  const closing = activeMarkRanges($pos, -1).filter(({ to }) => to === $pos.pos)
    .sort((a, b) => b.from - a.from || b.order - a.order);
  const opening = activeMarkRanges($pos).filter(({ from }) => from === $pos.pos)
    .sort((a, b) => b.to - a.to || a.order - b.order);
  const heading = $pos.parent.type.name === 'heading' && $pos.parentOffset === 0;
  const parts = closing.map(({ mark, delimiters }) => ({ mark, text: delimiters[1], opens: false }));
  const closingLength = parts.reduce((length, { text }) => length + text.length, 0);
  if (heading) parts.push({ text: '#'.repeat($pos.parent.attrs.level) });
  parts.push(...opening.map(({ mark, delimiters }) => ({ mark, text: delimiters[0], opens: true })));
  if (!parts.length) return null;
  const text = parts.map((part) => part.text).join('');
  return { text, parts, heading, defaultOffset: closingLength ? (opening.length ? closingLength : 0) : text.length };
}

// A mark delimiter has no ProseMirror document positions of its own. Keep
// its caret offset in plugin state and leave the document untouched.
function selectDelimiterPosition(view, $pos, boundary, offset, scroll = true) {
  const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, $pos.pos));
  const meta = { pointer: null };
  if (boundary) {
    let marks = $pos.nodeBefore?.marks || [];
    let end = 0;
    for (const { mark, text, opens } of boundary.parts) {
      end += text.length;
      if (!mark || offset < end) continue;
      marks = opens ? mark.addToSet(marks) : mark.removeFromSet(marks);
    }
    tr.setStoredMarks(marks);
    meta.caret = { offset };
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
  const boundary = delimiterBoundary($from);
  const moveTo = ($pos, next, offset) => selectDelimiterPosition(view, $pos, next, offset);
  if (boundary) {
    const offset = (caret?.offset ?? boundary.defaultOffset) + direction;
    if (offset >= 0 && offset <= boundary.text.length) return moveTo($from, boundary, offset);
  }

  const adjacent = direction < 0 ? $from.nodeBefore : $from.nodeAfter;
  if (adjacent?.isText) {
    const { text } = adjacent;
    const character = graphemes?.segment(text).containing(direction < 0 ? text.length - 1 : 0).segment
      ?? Array.from(text).at(direction < 0 ? -1 : 0);
    const size = character.length;
    const $next = state.doc.resolve($from.pos + direction * size);
    const next = delimiterBoundary($next);
    if (next || boundary || adjacent.marks.length) return moveTo($next, next, direction < 0 ? next?.text.length : 0);
  } else if (!adjacent) {
    const edge = direction < 0 ? $from.before() : $from.after();
    const selection = TextSelection.findFrom(state.doc.resolve(edge), direction);
    if (selection instanceof TextSelection) {
      const next = delimiterBoundary(selection.$from);
      if (next || caret) return moveTo(selection.$from, next, direction < 0 ? next?.text.length : 0);
    }
  }
  return false;
}

const serializeInline = (serialize, schema, content) => serialize(
  schema.topNodeType.create(null, schema.nodes.paragraph.create(null, content)),
).replace(/\r?\n$/, '');

function deleteDelimiter(ctx, view, event) {
  if (event.key !== 'Backspace' && event.key !== 'Delete') return false;
  if (!view.editable || view.composing || isImeComposing(event) || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
    || event.target.closest?.('.cm-editor, input, textarea, button, select')) return false;
  const { state } = view;
  const { selection, schema } = state;
  const { $from } = selection;
  if (!selection.empty || !$from.parent.isTextblock || $from.parent.type.spec.code) return false;

  const forward = event.key === 'Delete';
  const opening = activeMarkRanges($from).filter((range) => range.from === $from.pos);
  const closing = forward && !opening.length ? activeMarkRanges($from, -1).filter((range) => range.to === $from.pos) : [];
  const atStart = opening.length > 0;
  const range = (atStart ? opening : closing).sort((a, b) => (a.to - a.from) - (b.to - b.from)
    || a.delimiters[0].length - b.delimiters[0].length)[0];
  const preference = activeMarkdownPairs(useConfigStore.getState());
  if (!range) {
    let text = '';
    $from.parent.forEach((node) => {
      text += node.isText && !node.marks.some((mark) => mark.type.spec.code) ? node.text : '\ufffc'.repeat(node.nodeSize);
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

  const [prefix, suffix] = range.delimiters;
  const paired = markdownPairEnabled(preference, prefix[0]);
  if (paired && (range.mark.type.name !== 'inlineCode' || prefix === '`')) {
    const tr = closeHistory(state.tr).removeMark(range.from, range.to, range.mark);
    if (range.mark.type.name === 'strong') {
      tr.addMark(range.from, range.to, schema.marks.emphasis.create({ marker: range.mark.attrs.marker }));
    }
    tr.setSelection(TextSelection.create(tr.doc, $from.pos)).setStoredMarks([]);
    event.preventDefault();
    view.dispatch(tr.scrollIntoView());
    return true;
  }

  const content = state.doc.slice(range.from, range.to).content;
  let shared = content.firstChild.marks.filter((mark) => !mark.eq(range.mark));
  content.forEach((child) => { shared = shared.filter((mark) => mark.isInSet(child.marks)); });
  const bodyNodes = [];
  content.forEach((child) => bodyNodes.push(child.mark(child.marks.filter(
    (mark) => !mark.eq(range.mark) && !mark.isInSet(shared),
  ))));
  const body = range.mark.type.spec.code ? state.doc.textBetween(range.from, range.to)
    : serializeInline(ctx.get(serializerCtx), schema, Fragment.fromArray(bodyNodes));
  const source = prefix + body + suffix;
  const index = atStart ? (forward ? 0 : prefix.trimEnd().length - 1) : prefix.length + body.length + suffix.search(/\S/);
  const next = paired ? `${prefix.replace('`', '')}${body}${suffix.replace(/`(?=[^`]*$)/, '')}`
    : source.slice(0, index) + source.slice(index + 1);
  const tr = closeHistory(state.tr).replaceWith(range.from, range.to,
    schema.nodes[sourceTypeName].create(null, schema.text(next), shared));
  tr.setSelection(TextSelection.create(tr.doc, range.from + 1 + Math.min(next.length, paired && index > 0 ? index - 1 : index)));
  event.preventDefault();
  view.dispatch(tr.scrollIntoView());
  return true;
}

function markerWidget(position, text, side, heading = false, offset) {
  return Decoration.widget(position, (view) => {
    const marker = view.dom.ownerDocument.createElement('span');
    marker.className = `moki-markdown-marker${heading ? ' moki-markdown-heading-marker' : ''}`;
    marker.setAttribute('aria-hidden', 'true');
    marker.dataset.mokiMarker = text;
    marker.dataset.markerSide = String(side);
    if (offset !== undefined) {
      marker.classList.add('moki-markdown-marker--with-caret');
      marker.dataset.markerBefore = text.slice(0, offset);
      marker.dataset.markerAfter = text.slice(offset);
      marker.append(view.dom.ownerDocument.createElement('i'));
    }
    return marker;
  }, { side, marks: [], ignoreForCoords: true, key: `markdown-marker:${side}:${text}:${offset ?? ''}` });
}

function trackInlineClick(view, event) {
  if (!view.editable || view.composing || event.detail !== 1 || event.shiftKey || event.ctrlKey ||
    event.metaKey || event.altKey || event.target.closest?.('a, button, .cm-editor')) return;
  const marker = event.target.closest?.('.moki-markdown-marker');
  const inline = event.target.closest?.('strong, b, em, i, del, s, code');
  if (!marker && !inline) return;

  // Resolve the click before revealing or hiding delimiters, which reflows
  // the rendered text underneath the pointer.
  let pos;
  let markerOffset;
  if (marker) {
    pos = view.posAtDOM(marker, 0);
    const box = marker.getBoundingClientRect();
    const text = marker.dataset.mokiMarker;
    markerOffset = box.width
      ? Math.round(Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) * text.length)
      : 0;
  } else {
    const range = view.dom.ownerDocument.caretRangeFromPoint?.(event.clientX, event.clientY);
    if (range && inline.contains(range.startContainer)) pos = view.posAtDOM(range.startContainer, range.startOffset);
    else pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
  }
  if (pos == null) return;
  const $pos = view.state.doc.resolve(pos);
  if (!$pos.parent.isTextblock || $pos.parent.type.spec.code) return;
  const boundary = delimiterBoundary($pos);
  let offset = boundary?.defaultOffset;
  if (marker && boundary) {
    offset = markerOffset;
    if (Number(marker.dataset.markerSide) < 0 && !marker.classList.contains('moki-markdown-marker--with-caret')) {
      offset += boundary.text.length - marker.dataset.mokiMarker.length;
    }
  }
  // Keep the rendered layout stable while native drag/word selection runs.
  // Reveal the caret and its delimiters together with the final selection.
  const { doc, selection } = view.state;
  const window = view.dom.ownerDocument.defaultView;
  if (!window) return;
  inlinePointerCleanup.get(view)?.();
  const listeners = new AbortController();
  const options = { capture: true, signal: listeners.signal };
  const pointer = { selection, caret: liveSyntaxKey.getState(view.state).caret, focused: view.hasFocus() };
  const cleanup = () => {
    listeners.abort();
    inlinePointerCleanup.delete(view);
  };
  const release = (click) => {
    cleanup();
    queueMicrotask(() => {
      if (view.isDestroyed || view.state.doc !== doc || liveSyntaxKey.getState(view.state).pointer !== pointer) return;
      const nativeSelection = view.dom.ownerDocument.getSelection();
      if (click && nativeSelection?.isCollapsed !== false) {
        view.focus();
        selectDelimiterPosition(view, $pos, boundary, offset, false);
      } else {
        view.dispatch(view.state.tr.setMeta(liveSyntaxKey, { pointer: null }));
      }
    });
  };
  const moved = (point) => Math.hypot(point.clientX - event.clientX, point.clientY - event.clientY) > 4;
  let dragged = false;
  inlinePointerCleanup.set(view, cleanup);
  window.addEventListener('mousemove', (move) => { dragged ||= moved(move); }, options);
  window.addEventListener('mouseup', (up) => {
    if (up.button === 0) release(!dragged && !moved(up) && view.dom.contains(up.target));
  }, options);
  window.addEventListener('dragend', () => release(false), options);
  window.addEventListener('blur', () => release(false), { signal: listeners.signal });
  view.dispatch(view.state.tr.setMeta(liveSyntaxKey, { pointer, caret: pointer.caret }));
}

function alignVirtualCaret(view) {
  if (!liveSyntaxKey.getState(view.state).caret) return;
  const cursor = view.dom.querySelector('.moki-markdown-marker--with-caret i');
  if (!cursor) return;
  const anchor = cursor.getBoundingClientRect();
  if (!anchor.height) return;
  const { $from } = view.state.selection;
  const middle = (anchor.top + anchor.bottom) / 2;
  for (const side of [1, -1]) {
    const text = side > 0 ? $from.nodeAfter : $from.nodeBefore;
    if (!text?.isText) continue;
    // Read the adjacent real text box, not the widget that shares its position.
    const step = text.nodeSize > 1 ? side : 0;
    const { top, bottom } = view.coordsAtPos($from.pos + step, step ? -side : side);
    if (top >= bottom || middle < top || middle > bottom) continue;
    cursor.style.setProperty('--moki-caret-top', `${top - anchor.top}px`);
    cursor.style.setProperty('--moki-caret-height', `${bottom - top}px`);
    return;
  }
  cursor.style.removeProperty('--moki-caret-top');
  cursor.style.removeProperty('--moki-caret-height');
}

function pendingMarkers($caret) {
  const before = $caret.nodeBefore;
  if (!before?.isText || before.marks.length) return [];
  const text = before.text.slice(-2048);
  const start = $caret.pos - text.length;
  const ghost = (from, to) => Decoration.inline(start + from, start + to, { class: 'moki-markdown-ghost' });
  const after = $caret.nodeAfter;
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
    if (from && /[\w:/\\]/.test(text[from - 1])) continue;
    const rest = text.slice(to);
    if (/^\s/.test(rest) || (token === '$' && /^\d/.test(rest))) continue;
    if (token.endsWith('[')) {
      if (/\]\([^)]*\)$/.test(rest)) continue;
      const address = rest.indexOf('](');
      return address < 0 ? [ghost(from, to)] : [ghost(from, to), ghost(to + address, to + address + 2)];
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
  if (!view.editable || !selection.empty || $from.parent.type.name !== 'paragraph'
    || $from.parentOffset !== $from.parent.content.size || $from.parent.childCount !== 1
    || !$from.parent.firstChild.isText || $from.parent.firstChild.marks.length
    || !markdownPairEnabled(activeMarkdownPairs(useConfigStore.getState()), '`')) return null;
  const fence = readMarkdownFence($from.parent.textContent);
  return fence && { ...fence, $from };
}

function openCodeFence(view, $pos, language, autoOpened = false) {
  const { state } = view;
  const type = state.schema.nodes.code_block;
  const pos = $pos.before();
  const parent = $pos.node(-1), index = $pos.index(-1);
  const code = type.create({ language });
  const replacement = parent.canReplaceWith(index, index + 1, type) ? Fragment.from(code)
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


// 逐字输入闭合星号后，段落文本恰好构成 **内容**（或 __ 内容 __）时，
// 直接替换为 strong mark；避免依赖刷新时重新解析 Markdown。
const CLOSED_ASTERISK_PAIR = /^(\*\*|__)([^\s*_~\`](?:[\s\S]*?[^\s*_~\`])?)\1$/;

function completeClosedAsterisk(view, $pos, value) {
  const { state } = view;
  const offset = $pos.parentOffset;
  if ($pos.parent.childCount !== 1 || !$pos.parent.firstChild?.isText || $pos.parent.firstChild.marks.length) return false;
  const next = value.slice(0, offset) + '*' + value.slice(offset);
  const match = CLOSED_ASTERISK_PAIR.exec(next);
  if (!match) return false;
  const [, delimiter, content] = match;
  const type = state.schema.marks.strong;
  if (!type) return false;
  const mark = type.create({ marker: delimiter[0] });
  const from = $pos.before() + 1;
  const tr = closeHistory(state.tr);
  tr.insertText('*', $pos.pos);
  tr.replaceWith(from, from + next.length, state.schema.text(content, mark));
  tr.setSelection(TextSelection.create(tr.doc, from + content.length)).setStoredMarks([mark]);
  view.dispatch(tr.scrollIntoView());
  return true;
}

function typeAsterisk(view, $pos, value, text) {
  const { state } = view;
  const marks = state.storedMarks ?? $pos.marks();
  if (marks.some((mark) => mark.type.spec.code) || $pos.nodeAfter?.marks.some((mark) => mark.type.spec.code)) return false;
  if (text === '*') {
    const after = $pos.nodeAfter?.marks || [];
    const ending = marks.find((mark) => asteriskWidth(mark) && !mark.isInSet(after) && mark.isInSet($pos.nodeBefore?.marks || []));
    if (ending) {
      const tr = state.tr;
      if (asteriskWidth(ending) === 2 && !liveSyntaxKey.getState(state).closing) tr.setMeta(liveSyntaxKey, { closing: true });
      else tr.setStoredMarks(ending.removeFromSet(marks));
      view.dispatch(tr);
      return true;
    }
    if (completeClosedAsterisk(view, $pos, value)) return true;
    const edit = markdownAsteriskEdit(value, $pos.parentOffset);
    if (!edit) return false;
    const tr = closeHistory(state.tr);
    if (edit.text) tr.insertText(edit.text, $pos.pos);
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, $pos.pos + edit.advance)).scrollIntoView());
    return true;
  }
  if (/^[\t \u00a0]$/.test(text) && $pos.parent.type.name === 'paragraph'
    && /^ {0,3}\*{4}$/.test(value) && emptyAsteriskPair(value, $pos.parentOffset) === 2) {
    // The third typed asterisk also starts the existing thematic break shortcut.
    const type = state.schema.nodes.hr;
    const index = $pos.index(-1);
    if ($pos.node(-1).canReplaceWith(index, index + 1, type)) {
      view.dispatch(closeHistory(state.tr).replaceWith($pos.before(), $pos.after(), type.create()).scrollIntoView());
      return true;
    }
  }
  return false;
}



function completeInlinePair(view, $pos, value, text, composition, paste = false) {
  const { state } = view;
  const offset = $pos.parentOffset;
  const symbol = value[offset];
  const width = emptyMarkdownMarkPair(value, offset);
  if (!width || !text || text === symbol || /[\r\n]/.test(text)
    || (symbol !== '`' && text.trim() !== text)) return false;
  const marks = state.storedMarks ?? $pos.marks();
  if (marks.some((mark) => mark.type.spec.code) || $pos.nodeAfter?.marks.some((mark) => mark.type.spec.code)) return false;
  const type = state.schema.marks[symbol === '`' ? 'inlineCode'
    : symbol === '~' ? 'strike_through' : width === 2 ? 'strong' : 'emphasis'];
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
  if (!view.editable || view.composing || !empty || !$from.parent.isTextblock
    || $from.parent.type.spec.code) return false;
  const value = $from.parent.textBetween(0, $from.parent.content.size, '\n', '\ufffc');
  return completeInlinePair(view, $from, value, text, undefined, true);
}

function handleSmartTextInput(view, from, to, text) {
  if (view.composing || from !== to) return false;
  const { state } = view;
  const $pos = state.doc.resolve(from);
  if (!$pos.parent.isTextblock || $pos.parent.type.spec.code) return false;
  const value = $pos.parent.textBetween(0, $pos.parent.content.size, '\n', '\ufffc');
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
  if (markdownPairEnabled(preference, '*') && typeAsterisk(view, $pos, value, text)) return true;
  if (completeInlinePair(view, $pos, value, text)) return true;
  // Explicitly exiting an inline mark takes precedence over DOM mark inheritance.
  if (text && state.storedMarks && (liveSyntaxKey.getState(state).caret || $pos.nodeBefore?.marks.some((mark) => !mark.isInSet(state.storedMarks)
    && !mark.isInSet($pos.nodeAfter?.marks || []) && (mark.type.spec.code
      || (asteriskWidth(mark) && markdownPairEnabled(preference, '*')))))) {
    view.dispatch(state.tr.insertText(text, from, to).scrollIntoView());
    return true;
  }
  if (text.length !== 1 || !markdownPairEnabled(preference, text)) return false;
  const edit = matchingMarkdownBracket(value, $pos.parentOffset, text);
  if (!edit) return false;
  if (text === ')' && !edit.text && inlineLinkPattern.test(value.slice(0, $pos.parentOffset) + text)) return false;
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
    apply(tr, previous) {
      const update = tr.getMeta(liveSyntaxKey);
      if (!update && !tr.docChanged && !tr.selectionSet && !tr.storedMarksSet) return previous;
      return { closing: update?.closing || false, caret: update?.caret || null,
        composition: tr.getMeta('composition') ?? previous.composition,
        pointer: update && 'pointer' in update ? update.pointer : tr.docChanged ? null : previous.pointer };
    },
  },
  view(editorView) {
    let previous = '';
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => alignVirtualCaret(editorView)) : null;
    resize?.observe(editorView.dom);
    return {
      update(view) {
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
            containsTarget: (target) => view.dom.contains(target),
            getAnchor: () => {
              if (!current()) return null;
              const { left } = view.coordsAtPos(pending.$from.start(), 1);
              const { top, bottom } = view.coordsAtPos(pending.$from.pos);
              const pane = view.dom.closest('.md-preview--milkdown')?.getBoundingClientRect();
              return pane && (bottom <= pane.top || top >= pane.bottom) ? null : { x: left, y: bottom };
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
        inlinePointerCleanup.get(editorView)?.();
      },
    };
  },
  appendTransaction(transactions, _oldState, state) {
    if (!transactions.some((tr) => tr.docChanged)) return null;
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
      if (pointer) return { class: 'moki-markdown-pointer-pending' };
      return caret ? { class: 'moki-markdown-virtual-caret' } : {};
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
        if (event.button === 0) trackInlineClick(view, event);
        if (event.button !== 2 || !event.target.closest?.('a[href]')) return false;
        // Focusing here would insert markers and move the link before the
        // media context menu receives the browser's contextmenu event.
        event.preventDefault();
        return true;
      },
    },
    decorations(state) {
      const { doc } = state;
      const { caret, pointer } = liveSyntaxKey.getState(state);
      if (pointer && !pointer.focused) return null;
      const selection = pointer?.selection || state.selection;
      const { $from } = selection;
      if (!$from.parent.isTextblock || $from.parent.type.spec.code) return null;
      const next = selection.empty ? $from.nodeAfter : selection.node;
      const formula = next?.type.name === 'math_inline' && Decoration.node($from.pos, $from.pos + next.nodeSize, {
        class: 'moki-markdown-math-source', 'data-moki-math-source': `$${next.attrs.value}$`,
      });
      if (!selection.empty) return formula ? DecorationSet.create(doc, [formula]) : null;
      const virtualCaret = pointer ? pointer.caret : caret;
      const decorations = pendingMarkers($from);
      const opening = new Map(), closing = new Map();
      const ranges = activeMarkRanges($from);
      if (virtualCaret) ranges.push(...activeMarkRanges($from, -1).filter((range) => range.to === $from.pos));
      ranges.sort((a, b) => a.from - b.from || b.to - a.to || a.order - b.order);
      for (const { from, to, delimiters: [open, close] } of ranges) {
        opening.set(from, (opening.get(from) || '') + open);
        closing.set(to, close + (closing.get(to) || ''));
      }
      if ($from.parent.type.name === 'heading' && $from.parentOffset === 0) {
        if (!virtualCaret) decorations.push(markerWidget($from.pos, '#'.repeat($from.parent.attrs.level), -2, true));
        decorations.push(Decoration.node($from.before(), $from.after(), { class: 'moki-markdown-heading-source' }));
      }
      if (formula) decorations.push(formula);
      if (virtualCaret) {
        const boundary = delimiterBoundary($from);
        opening.delete($from.pos);
        closing.delete($from.pos);
        if (boundary) decorations.push(markerWidget($from.pos, boundary.text, -1, boundary.heading, virtualCaret.offset));
      }
      for (const [pos, text] of opening) decorations.push(markerWidget(pos, text, -1));
      for (const [pos, text] of closing) decorations.push(markerWidget(pos, text, 1));
      return decorations.length ? DecorationSet.create(doc, decorations) : null;
    },
  },
}));

export const milkdownBlockSelection = $prose(() => new Plugin({
  props: {
    decorations({ doc, selection }) {
      if (selection.empty) return null;
      const { from, to } = selection, blocks = [];
      doc.nodesBetween(from, to, (node, pos) => {
        const end = pos + node.nodeSize;
        if (node.type.name === 'code_block' && from <= pos + 1 && to >= end - 1 && (from <= pos || to >= end)) {
          blocks.push(Decoration.node(pos, end, { class: 'moki-block-selected' }));
        }
        if (node.type.name !== 'blockquote') return;
        const first = TextSelection.findFrom(doc.resolve(pos + 1), 1, true);
        const last = TextSelection.findFrom(doc.resolve(end - 1), -1, true);
        if ((from <= pos && to >= end) || (first && last && first.from < end && last.to > pos && from <= first.from && to >= last.to)) {
          blocks.push(Decoration.node(pos, end, { class: 'moki-block-selected' }));
        }
      });
      return blocks.length ? DecorationSet.create(doc, blocks) : null;
    },
  },
}));

// Validate completed links and images with the same Markdown parser used to
// load documents. Input rules keep the conversion in the normal undo history.
export const milkdownInlineLinkRule = $inputRule((ctx) => new InputRule(
  inlineLinkPattern,
  (state, match, start, end) => {
    const paragraph = ctx.get(parserCtx)(match[0]).firstChild;
    if (!paragraph?.childCount || paragraph.type.name !== 'paragraph') return null;
    if (markdownPairEnabled(activeMarkdownPairs(useConfigStore.getState()), ')') && state.doc.resolve(end).nodeAfter?.text?.startsWith(')')) end++;
    if (paragraph.childCount === 1 && paragraph.firstChild.type.name === 'image') {
      return state.tr.replaceWith(start, end, paragraph.content);
    }
    const link = paragraph.firstChild.marks.find((mark) => mark.type.name === 'link');
    if (!link) return null;
    let valid = true;
    paragraph.forEach((node) => { if (!link.isInSet(node.marks)) valid = false; });
    if (!valid) return null;
    const labelStart = start + 1, labelEnd = labelStart + match[1].length;
    const label = state.doc.slice(labelStart, labelEnd).content;
    let alreadyFormatted = false;
    label.forEach((node) => { if (!node.isText || node.marks.length) alreadyFormatted = true; });
    const tr = alreadyFormatted
      ? state.tr.delete(labelEnd, end).delete(start, labelStart).addMark(start, start + label.size, link)
      : state.tr.replaceWith(start, end, paragraph.content);
    return tr.setStoredMarks(state.storedMarks || []);
  },
));
