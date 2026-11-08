const taskPrefix = /^([ \t]*(?:>[ \t]*)*)(?:[-+*]|\d{1,9}[.)])[ \t\u00a0]+\[[ xX\u00a0]\](?:[ \t\u00a0]+|(?=\r?$))/gm;
const opaqueTypes = new Set(['code', 'inlineCode', 'html', 'yaml', 'toml', 'math', 'inlineMath', 'link', 'image', 'definition']);

function recognizeEmptyTasks(tree, source) {
  function visit(node) {
    if (node.type === 'listItem' && node.checked == null) {
      const paragraph = node.children[0];
      const first = paragraph?.children?.[0];
      const position = first?.position;
      if (paragraph?.type === 'paragraph' && paragraph.children.length === 1 && first.type === 'text' && position) {
        const raw = source.slice(position.start.offset, position.end.offset);
        const marker = /^\[([ xX])\][ \t]*$/.exec(raw);
        if (marker) {
          node.checked = marker[1] !== ' ';
          paragraph.children = [];
        }
      }
    }
    node.children?.forEach(visit);
  }
  if (source.includes('[')) visit(tree);
  return tree;
}

export default function remarkTaskListSpacing() {
  const parse = this.parser;
  this.parser = function parseWithTaskSpacing(source, file) {
    const tree = parse.call(this, source, file);
    if (!source.includes('\u00a0')) return recognizeEmptyTasks(tree, source);

    const opaque = [];
    function visit(node) {
      if (opaqueTypes.has(node.type) && node.position) {
        opaque.push([node.position.start.offset, node.position.end.offset]);
        return;
      }
      node.children?.forEach(visit);
    }
    visit(tree);

    let range = 0;
    const normalized = source.replace(taskPrefix, (prefix, indentation, start) => {
      const marker = start + indentation.length;
      while (range < opaque.length && opaque[range][1] <= marker) range++;
      if (range < opaque.length && opaque[range][0] <= marker) return prefix;
      return prefix.replaceAll('\u00a0', ' ');
    });
    // Replace one character at a time so downstream source offsets stay valid.
    return recognizeEmptyTasks(normalized === source ? tree : parse.call(this, normalized, file), normalized);
  };
}
