const bracketPairs = [
  ['(', ')', 'round'], ['[', ']', 'square'], ['{', '}', 'curly'], ['<', '>', 'angle'],
  ['（', '）', 'fullwidthRound'], ['【', '】', 'fullwidthSquare'], ['「', '」', 'corner'],
  ['『', '』', 'doubleCorner'], ['《', '》', 'bookTitle'],
];
export const markdownBrackets = new Map(bracketPairs);
const closers = new Set(markdownBrackets.values());
const openByClose = new Map([...markdownBrackets].map(([open, close]) => [close, open]));
export const markdownPairOptions = [
  ...bracketPairs, ['*', '*', 'asterisk'], ['_', '_', 'underscore'], ['~', '~', 'tilde'], ['`', '`', 'backtick'],
].map(([open, close, name]) => ({ value: open, label: `${open} ${close}`, name }));
const defaultPairs = markdownPairOptions.map(({ value }) => value);

export function normalizeMarkdownPairs(value) {
  if (value === false) return [];
  return defaultPairs.filter((symbol) => !Array.isArray(value) || value.includes(symbol));
}

export function normalizeMarkdownPairSettings(config = {}, defaults = {}) {
  const { markdownSmartPairs: pairs, markdownSmartPairsEnabled: enabled } = config;
  return {
    markdownSmartPairsEnabled: typeof enabled === 'boolean' ? enabled
      : typeof pairs === 'boolean' ? pairs : defaults.markdownSmartPairsEnabled !== false,
    markdownSmartPairs: normalizeMarkdownPairs(typeof pairs === 'boolean' ? undefined : pairs ?? defaults.markdownSmartPairs),
  };
}

export function activeMarkdownPairs(config) {
  return config.markdownSmartPairsEnabled === false ? false : config.markdownSmartPairs;
}

export function markdownPairEnabled(value, symbol) {
  return value !== false && (!Array.isArray(value) || value.includes(openByClose.get(symbol) || symbol));
}

function isEscaped(text, offset) {
  let previous = offset;
  while (text[previous - 1] === '\\') previous--;
  return (offset - previous) % 2 === 1;
}

export function isEmptyBacktickPair(text, offset) {
  return text[offset - 1] === '`' && text[offset] === '`' && text[offset - 2] !== '`'
    && text[offset + 1] !== '`' && !isEscaped(text, offset - 1);
}

export function markdownBacktickEdit(text, offset) {
  if (isEmptyBacktickPair(text, offset)) {
    return /^( {0,3})``$/.test(text) ? { kind: 'fence' } : { kind: 'skip' };
  }
  if (text[offset] === '`') return { kind: 'skip' };
  if (text[offset - 1] === '`' && text[offset - 2] !== '`' && !isEscaped(text, offset - 1)) return { kind: 'pair' };
  return null;
}

export function emptyAsteriskPair(text, offset) {
  const width = text[offset - 2] === '*' ? 2 : 1;
  const start = offset - width, end = offset + width;
  return start >= 0 && text[start - 1] !== '*' && text[end] !== '*'
    && text.slice(start, end) === '*'.repeat(width * 2) && !isEscaped(text, start) ? width : 0;
}

export function emptyMarkdownMarkPair(text, offset) {
  const symbol = text[offset];
  if (symbol === '*') return emptyAsteriskPair(text, offset);
  if (symbol === '`') return Number(isEmptyBacktickPair(text, offset));
  if (symbol !== '_' && symbol !== '~') return 0;
  const width = text[offset + 1] === symbol ? 2 : 1;
  const start = offset - width, end = offset + width;
  if (start < 0 || (symbol === '~' && width !== 2) || isEscaped(text, start)
    || text[start - 1] === symbol || text[end] === symbol
    || text.slice(start, end) !== symbol.repeat(width * 2)) return 0;
  // Underscores inside identifiers are literal in Markdown.
  if (symbol === '_' && /[\p{L}\p{N}]/u.test((text[start - 1] || '') + (text[end] || ''))) return 0;
  return width;
}

export function markdownAsteriskEdit(text, offset) {
  // 空对优先：*|* 再输入 * 扩成 **|**（粗体空对），**|** 再输入 * 保持空对。
  const pairWidth = emptyAsteriskPair(text, offset);
  if (pairWidth === 1) return { text: '**', advance: 1 };
  if (pairWidth === 2) return { text: '', advance: 0 };
  if (text[offset] === '*') {
    const pair = markdownPairDeletion(text, offset, 'Delete');
    if (pair && pair[0].to !== offset && offset >= pair[1].from) return { text: '', advance: 1 };
  }
  if (text[offset - 1] === '*' && text[offset - 2] !== '*' && text[offset] !== '*' && !isEscaped(text, offset - 1)) {
    const closing = markdownPairDeletion(text, offset, 'Backspace')?.[1];
    if (!closing || offset - 1 < closing.from) return { text: '*', advance: 0 };
  }
  return null;
}

export function inMarkdownCodeSpan(text, offset) {
  const runs = [...text.matchAll(/`+/g)];
  for (let index = 0; index < runs.length; index++) {
    const start = runs[index];
    if (start.index >= offset) return false;
    if (isEscaped(text, start.index)) continue;
    const end = runs.findIndex((run, next) => next > index && run[0].length === start[0].length);
    if (end < 0) continue;
    if (offset <= runs[end].index) return true;
    index = end;
  }
  return false;
}

export function matchingMarkdownBracket(text, offset, input) {
  if (closers.has(input) && text[offset] === input) return { text: '', advance: 1 };
  const close = markdownBrackets.get(input);
  if (!close || !/^[\s)\]}>）】」』》]?$/.test(text[offset] || '')) return null;
  return isEscaped(text, offset) ? null : { text: input + close, advance: 1 };
}

// Return the two ranges to delete, using offsets in a single Markdown line.
// Code spans are consumed as units so punctuation inside them stays literal.
export function markdownPairDeletion(text, offset, key, includeMarkup = true) {
  const target = key === 'Backspace' ? offset - 1 : offset;
  const character = text[target];
  if (!character || text.length > 65536 || (!markdownBrackets.has(character) && !closers.has(character)
    && (!includeMarkup || !/^[*_~`]$/.test(character)))) return null;
  const brackets = [], marks = new Map();
  const hit = (open, close, width = 1, remove = 1) => {
    if ((target >= open && target < open + width) || (target >= close && target < close + width)) {
      return [{ from: open + width - remove, to: open + width }, { from: close, to: close + remove }];
    }
    return null;
  };
  for (let index = 0; index < text.length; index++) {
    const token = text[index];
    if (token === '\\') { index++; continue; }
    if (includeMarkup && token === '`') {
      const start = index;
      while (text[index + 1] === '`') index++;
      const width = index - start + 1;
      let close = index + 1;
      while ((close = text.indexOf('`', close)) >= 0) {
        let end = close + 1;
        while (text[end] === '`') end++;
        if (end - close === width) {
          const pair = hit(start, close, width);
          if (pair) return pair;
          index = end - 1;
          break;
        }
        close = end;
      }
    } else if (includeMarkup && /[*_~]/.test(token)) {
      const start = index;
      while (text[index + 1] === token) index++;
      const width = index - start + 1;
      if (width > 3 || (token === '~' && width > 2)) continue;
      const before = text[start - 1] || ' ', after = text[index + 1] || ' ';
      if (token === '_' && /[\p{L}\p{N}]/u.test(before) && /[\p{L}\p{N}]/u.test(after)) continue;
      const id = token.repeat(width), opening = marks.get(id);
      if (opening != null && /\S/.test(before)) {
        const pair = hit(opening, start, width, token === '~' ? width : 1);
        if (pair) return pair;
        marks.delete(id);
      } else if (/\S/.test(after)) marks.set(id, start);
    } else if (markdownBrackets.has(token)) brackets.push({ index, close: markdownBrackets.get(token) });
    else if (closers.has(token) && brackets.at(-1)?.close === token) {
      const opening = brackets.pop();
      const pair = hit(opening.index, index);
      if (pair) return pair;
    }
  }
  if (includeMarkup && character === '*' && emptyAsteriskPair(text, offset) && !inMarkdownCodeSpan(text, offset)) {
    return [{ from: offset - 1, to: offset }, { from: offset, to: offset + 1 }];
  }
  return null;
}
