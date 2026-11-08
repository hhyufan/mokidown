// Editors and pasted text can put a no-break space in the task marker.
// Recognize it only at a list item's raw paragraph start, so escaped markers,
// normal prose and fenced code keep their original meaning.
export default function remarkTaskListSpacing() {
  return (tree, file) => {
    const source = String(file.value);
    function visit(node) {
      if (node.type === 'listItem' && node.checked == null) {
        const paragraph = node.children[0];
        const first = paragraph?.children?.[0];
        const start = paragraph?.position?.start?.offset;
        if (paragraph?.type === 'paragraph' && first?.type === 'text' && Number.isInteger(start)) {
          const marker = /^\[([ xX\u00a0])\](?:[ \t\u00a0]+|$)/.exec(source.slice(start, paragraph.position.end.offset));
          if (marker?.[0].includes('\u00a0') && first.value.startsWith(marker[0])) {
            node.checked = /x/i.test(marker[1]);
            first.value = first.value.slice(marker[0].length);
            if (!first.value) paragraph.children.shift();
          }
        }
      }
      for (const child of node.children || []) visit(child);
    }
    visit(tree);
  };
}
