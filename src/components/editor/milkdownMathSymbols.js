/**
 * 公式符号表，以及「这一串算不算写完了」的判定。
 *
 * 补全列表按它过滤、预览按它决定要不要把源码喂给 KaTeX，两头必须认得同一批编码：
 * 分开放迟早会一边觉得已经写完、另一边还在猜下一个宏。
 */

// symbol 是列表里显示的字符，snippet 是真正写进源码态的 LaTeX 片段。
export const mathSymbolSnippets = [
  ['α', '\\alpha'], ['β', '\\beta'], ['γ', '\\gamma'], ['θ', '\\theta'],
  ['λ', '\\lambda'], ['μ', '\\mu'], ['π', '\\pi'], ['σ', '\\sigma'],
  ['√', '\\sqrt{}'], ['∑', '\\sum_{}'], ['∫', '\\int_{}'], ['∞', '\\infty'],
  ['≠', '\\neq'], ['≈', '\\approx'], ['≤', '\\leq'], ['≥', '\\geq'], ['±', '\\pm'],
  ['a/b', '\\frac{}{}'],
];

const codes = mathSymbolSnippets.map(([, snippet]) => snippet.toLowerCase());

// 表里到底有没有以这一段开头的编码。
export const hasCandidate = (query) => codes.some((code) => code.startsWith(query.toLowerCase()));

// 纯宏名（`\pi`）后面紧跟字母就会粘成另一个控制序列（`\pir`），所以补一个分隔空格；
// 带反斜杠的下一个宏能自己截断前一个，因此宏接宏不需要空格。
export const needsSeparator = (snippet) => /^\\\p{L}+$/u.test(snippet);

// 编码已经打全（`\alpha`）时不再补全：列表一开着就会拦住方向键，而向上/向下正是
// 离开公式源码态的手势；没打完（`\al`）才接管。带模板的片段只取宏名那一段。
export const completeMacros = new Set(mathSymbolSnippets
  .map(([, snippet]) => /^\\\p{L}+/u.exec(snippet)?.[0])
  .filter(Boolean));

// 正文末尾那段 `\`+字母。
const trailingMacro = /\\\p{L}+$/u;

/**
 * 正文是不是停在一个还没打完的宏上。
 *
 * 打字必然经过 `\i` → `\in` → `\inf` → `\infty`，而 KaTeX 认得其中大半的前缀：
 * `\in` 排出「属于」、`\inf` 干脆原样印成 inf，看着就像补全挑错了符号。
 * 表里 `\infty` 开头这些编码还没写全的中间段一律不算写完；已经算一个完整宏的
 * （`\int` 来自 `\int_{}`）照常渲染，`e^2 x` 这种末尾没有反斜杠的更不受影响。
 */
export const endsWithPartialMacro = (value) => {
  const token = trailingMacro.exec(value)?.[0];
  return !!token && hasCandidate(token) && !completeMacros.has(token);
};
