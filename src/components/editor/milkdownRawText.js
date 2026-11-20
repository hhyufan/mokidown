import { $markSchema, $remark } from '@milkdown/kit/utils';

const escapeType = 'mokiCharacterEscape';
export const characterEscapeMarkName = 'moki_character_escape';
const explicitEscape = $markSchema(characterEscapeMarkName, () => ({
  inclusive: false,
  priority: 1000,
  parseDOM: [{ tag: 'span[data-moki-character-escape]' }],
  toDOM: () => ['span', { 'data-moki-character-escape': '' }, 0],
  parseMarkdown: {
    match: (node) => node.type === escapeType,
    runner: (state, node, type) => state.openMark(type).addText(node.value).closeMark(type),
  },
  toMarkdown: {
    match: (mark) => mark.type.name === characterEscapeMarkName,
    runner: (state, _mark, node) => {
      state.addNode(escapeType, undefined, node.text);
      return true;
    },
  },
}));

// Markdown 语法判定要读的段落文本：转义过的字符（文件里的 `\$` 读进来就是挂了上面
// 那个 mark 的正文，反斜杠不进文档）既不是公式定界符也开不了斜体，换成占位符摘掉。
// 占位符用 inline 子节点的记号 `\ufffc`，既有判定一律当「跨了别的节点」避让；长度不变，
// 下标还能和文档位置一个一个对上。
export function syntaxScanText(block) {
  const value = block.textBetween(0, block.content.size, '\n', '\ufffc');
  const type = block.type.schema.marks[characterEscapeMarkName];
  if (!type) return value;
  let result = value;
  let offset = 0;
  block.forEach((node) => {
    if (node.isText && type.isInSet(node.marks)) {
      result = result.slice(0, offset) + '\ufffc'.repeat(node.text.length) + result.slice(offset + node.text.length);
    }
    offset += node.nodeSize;
  });
  return result;
}

const rawText = $remark('mokiRawMarkdownText', () => function remarkRawMarkdownText() {
  const data = this.data();
  (data.fromMarkdownExtensions ||= []).push({
    enter: {
      characterEscape(token) { this.enter({ type: escapeType, value: '' }, token); },
    },
    exit: {
      characterEscapeValue(token) { this.stack.at(-1).value = this.sliceSerialize(token); },
      characterEscape(token) { this.exit(token); },
    },
  });
  (data.toMarkdownExtensions ||= []).push({
    handlers: {
      [escapeType]: (node) => [...node.value].map((char) => `\\${char}`).join(''),
    },
  });
});

export const milkdownRawText = [...explicitEscape, rawText];
