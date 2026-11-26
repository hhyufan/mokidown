/** Reflow whitespace without rewriting numeric literals, keys or escapes. */
export function formatJsonDocument(source, indentation = '') {
  JSON.parse(source);
  const tokens = source.match(/"(?:\\[\s\S]|[^"\\])*"|[{}[\],:]|[^\s{}[\],:"]+/g);
  if (!indentation) return tokens.join('');

  const parts = [];
  let depth = 0;
  for (const [index, token] of tokens.entries()) {
    const previous = tokens[index - 1];
    const opening = token === '{' || token === '[';
    const closing = token === '}' || token === ']';
    if (closing) depth--;
    const afterOpening = previous === '{' || previous === '[';
    if (previous === ',' || (closing && !afterOpening) || (afterOpening && !closing)) {
      parts.push('\n', indentation.repeat(depth));
    }
    if (previous === ':') parts.push(' ');
    parts.push(token);
    if (opening) depth++;
  }
  return parts.join('');
}

/** 去掉 JSONC 里的行注释与块注释（字符串内部的注释符保持不变）。 */
export function stripJsonComments(source) {
  let result = '';
  let inString = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === '\n') {
        lineComment = false;
        result += char;
      }
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      result += char;
      if (char === '\\') {
        result += source[index + 1] ?? '';
        index += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    result += char;
  }
  return result;
}

/** 解析带 // 注释的 JSON（JSONC）。 */
export function parseJsonDocument(source) {
  return JSON.parse(stripJsonComments(String(source || '')));
}
