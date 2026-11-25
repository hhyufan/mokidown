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
