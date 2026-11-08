import { $markSchema, $remark } from '@milkdown/kit/utils';

const escapeType = 'mokiCharacterEscape';
const explicitEscape = $markSchema('moki_character_escape', () => ({
  inclusive: false,
  priority: 1000,
  parseDOM: [{ tag: 'span[data-moki-character-escape]' }],
  toDOM: () => ['span', { 'data-moki-character-escape': '' }, 0],
  parseMarkdown: {
    match: (node) => node.type === escapeType,
    runner: (state, node, type) => state.openMark(type).addText(node.value).closeMark(type),
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'moki_character_escape',
    runner: (state, _mark, node) => {
      state.addNode(escapeType, undefined, node.text);
      return true;
    },
  },
}));

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
