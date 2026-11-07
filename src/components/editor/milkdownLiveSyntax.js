import { parserCtx, serializerCtx } from '@milkdown/kit/core';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { closeHistory, undo } from '@milkdown/kit/prose/history';
import { Fragment } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $inputRule, $nodeSchema, $prose } from '@milkdown/kit/utils';
import { isImeComposing } from '@utils/keyboard';
import useConfigStore from '@store/useConfigStore';
import { activeMarkdownPairs, emptyAsteriskPair, isEmptyBacktickPair, markdownAsteriskEdit, markdownBacktickEdit, markdownBrackets, markdownPairDeletion, markdownPairEnabled, matchingMarkdownBracket } from '@utils/markdownPairs';
import { CODE_FENCE_LANGUAGE_EVENT, completedFenceLanguage, readMarkdownFence } from '@utils/markdownCodeFence';

const sourceTypeName = 'moki_inline_syntax_source';
const liveSyntaxKey = new PluginKey('moki-live-syntax');
const inlineLinkPattern = /(?<!\\)!?\[([^\n[\]]*)\]\((?:[^()\n]|\([^()\n]*\))*\)$/;
const graphemes = Intl.Segmenter && new Intl.Segmenter(undefined, { granularity: 'grapheme' });

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
function moveAcrossDelimiters(view, direction) {
  const { state } = view;
  const { $from } = state.selection;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return false;
  const caret = liveSyntaxKey.getState(state).caret;
  const boundary = delimiterBoundary($from);
  const moveTo = ($pos, next, offset) => {
    const tr = state.tr.setSelection(TextSelection.create(state.doc, $pos.pos));
    if (next) {
      let marks = $pos.nodeBefore?.marks || [];
      let end = 0;
      for (const { mark, text, opens } of next.parts) {
        end += text.length;
        if (!mark || offset < end) continue;
        marks = opens ? mark.addToSet(marks) : mark.removeFromSet(marks);
      }
      tr.setStoredMarks(marks).setMeta(liveSyntaxKey, { caret: { offset } });
    }
    view.dispatch(tr.scrollIntoView());
    return true;
  };
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
    if (offset !== undefined) {
      marker.classList.add('moki-markdown-marker--with-caret');
      marker.dataset.markerBefore = text.slice(0, offset);
      marker.dataset.markerAfter = text.slice(offset);
      marker.append(view.dom.ownerDocument.createElement('i'));
    }
    return marker;
  }, { side, marks: [], ignoreForCoords: true, key: `markdown-marker:${side}:${text}:${offset ?? ''}` });
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

function openCodeFence(view, $pos, language) {
  const { state } = view;
  const type = state.schema.nodes.code_block;
  const pos = $pos.before();
  const parent = $pos.node(-1), index = $pos.index(-1);
  const code = type.create({ language });
  const replacement = parent.canReplaceWith(index, index + 1, type) ? Fragment.from(code)
    : Fragment.fromArray([state.schema.nodes.paragraph.create(), code]);
  if (!parent.canReplace(index, index + 1, replacement)) return false;
  const tr = closeHistory(state.tr).replaceWith(pos, $pos.after(), replacement);
  tr.setSelection(TextSelection.create(tr.doc, pos + replacement.size - code.nodeSize + 1));
  view.dispatch(tr.scrollIntoView());
  view.focus();
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
    const edit = markdownAsteriskEdit(value, $pos.parentOffset);
    if (!edit) return false;
    const tr = closeHistory(state.tr);
    if (edit.text) tr.insertText(edit.text, $pos.pos);
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, $pos.pos + edit.advance)).scrollIntoView());
    return true;
  }
  const width = emptyAsteriskPair(value, $pos.parentOffset);
  if (!width) return false;
  if (width === 2 && $pos.parent.type.name === 'paragraph' && /^ {0,3}\*{4}$/.test(value) && /^[\t \u00a0]$/.test(text)) {
    // The third typed asterisk also starts the existing thematic break shortcut.
    const type = state.schema.nodes.hr;
    const index = $pos.index(-1);
    if ($pos.node(-1).canReplaceWith(index, index + 1, type)) {
      view.dispatch(closeHistory(state.tr).replaceWith($pos.before(), $pos.after(), type.create()).scrollIntoView());
      return true;
    }
  }
  if (!/^\S[^\r\n]*$/.test(text)) return false;
  const type = width === 2 ? state.schema.marks.strong : state.schema.marks.emphasis;
  const nextMarks = type.create({ marker: '*' }).addToSet(marks);
  const from = $pos.pos - width;
  const tr = closeHistory(state.tr).replaceWith(from, $pos.pos + width, state.schema.text(text, nextMarks));
  tr.setSelection(TextSelection.create(tr.doc, from + text.length)).setStoredMarks(nextMarks);
  view.dispatch(tr.scrollIntoView());
  return true;
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
    if (text && !/[\r\n]/.test(text) && isEmptyBacktickPair(value, $pos.parentOffset)) {
      const marks = state.schema.marks.inlineCode.create().addToSet(state.storedMarks || $pos.marks());
      const tr = closeHistory(state.tr).replaceWith(from - 1, from + 1, state.schema.text(text, marks));
      tr.setSelection(TextSelection.create(tr.doc, from - 1 + text.length)).setStoredMarks(marks);
      view.dispatch(tr.scrollIntoView());
      return true;
    }
    if (from === state.selection.from && pendingCodeFence(view)) {
      if (text === ' ') {
        // Keep Markdown whitespace instead of Chromium's trailing nonbreaking space.
        view.dispatch(state.tr.insertText(text, from, to).scrollIntoView());
        return true;
      }
      if (/^[\w+.#-]+$/.test(text)) {
        const next = readMarkdownFence(value + text);
        const language = next && completedFenceLanguage(next.language);
        if (language && openCodeFence(view, $pos, language)) return true;
      }
    }
  }
  if (markdownPairEnabled(preference, '*') && typeAsterisk(view, $pos, value, text)) return true;
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
    init: () => ({ closing: false, caret: null }),
    apply(tr, previous) {
      const update = tr.getMeta(liveSyntaxKey);
      if (!update && !tr.docChanged && !tr.selectionSet && !tr.storedMarksSet) return previous;
      return { closing: update?.closing || false, caret: update?.caret || null };
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
      destroy() { resize?.disconnect(); },
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
    attributes: (state) => liveSyntaxKey.getState(state).caret ? { class: 'moki-markdown-virtual-caret' } : {},
    handleTextInput: handleSmartTextInput,
    handleDOMEvents: {
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
        if (event.button === 0 && liveSyntaxKey.getState(view.state).caret) {
          view.dispatch(view.state.tr.setSelection(view.state.selection));
        }
        if (event.button !== 2 || !event.target.closest?.('a[href]')) return false;
        // Focusing here would insert markers and move the link before the
        // media context menu receives the browser's contextmenu event.
        event.preventDefault();
        return true;
      },
    },
    decorations(state) {
      const { selection, doc } = state;
      const { $from } = selection;
      if (!$from.parent.isTextblock || $from.parent.type.spec.code) return null;
      const next = selection.empty ? $from.nodeAfter : selection.node;
      const formula = next?.type.name === 'math_inline' && Decoration.node($from.pos, $from.pos + next.nodeSize, {
        class: 'moki-markdown-math-source', 'data-moki-math-source': `$${next.attrs.value}$`,
      });
      if (!selection.empty) return formula ? DecorationSet.create(doc, [formula]) : null;
      const caret = liveSyntaxKey.getState(state).caret;
      const decorations = pendingMarkers($from);
      const opening = new Map(), closing = new Map();
      const ranges = activeMarkRanges($from);
      if (caret) ranges.push(...activeMarkRanges($from, -1).filter((range) => range.to === $from.pos));
      ranges.sort((a, b) => a.from - b.from || b.to - a.to || a.order - b.order);
      for (const { from, to, delimiters: [open, close] } of ranges) {
        opening.set(from, (opening.get(from) || '') + open);
        closing.set(to, close + (closing.get(to) || ''));
      }
      if ($from.parent.type.name === 'heading' && $from.parentOffset === 0) {
        if (!caret) decorations.push(markerWidget($from.pos, '#'.repeat($from.parent.attrs.level), -2, true));
        decorations.push(Decoration.node($from.before(), $from.after(), { class: 'moki-markdown-heading-source' }));
      }
      if (formula) decorations.push(formula);
      if (caret) {
        const boundary = delimiterBoundary($from);
        opening.delete($from.pos);
        closing.delete($from.pos);
        if (boundary) decorations.push(markerWidget($from.pos, boundary.text, -1, boundary.heading, caret.offset));
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
