import { parseMarkdownBlocks } from '../components/editor/markdownSections';
import { collectTasks } from './taskListTree';

const htmlHeading = /^\s*<h([1-6])(?:\s[^>]*)?>(.*)$/i;
const htmlLookahead = 10;
const normalizeLabel = (text) => text.replace(/\s+/g, ' ').trim();

function labelOf(node) {
  if (node.type === 'html') return '';
  if (node.type === 'image' || node.type === 'imageReference') return node.alt || '';
  if (node.type === 'text') {
    // Keep the visible label of reference links whose definition is missing.
    return node.value.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1');
  }
  return node.children?.map(labelOf).join('') ?? node.value ?? ' ';
}

export function extractItems(content) {
  if (!content) return [];
  const items = [];
  let currentHeadingLevel = 0;
  const blocks = parseMarkdownBlocks(content);
  const tasks = new Map(
    collectTasks(
      { children: blocks },
      (node) => node.children || [],
      (node) =>
        node.type === 'listItem' && typeof node.checked === 'boolean'
          ? { node, checked: node.checked }
          : null,
    ).map(({ node, state }) => [node, state]),
  );

  function addHeading(level, text, line, indent) {
    if (!text) return;
    currentHeadingLevel = level;
    items.push({ type: 'heading', level, text, line, ...(indent > 0 ? { indent } : {}) });
  }

  function visitHtml(node, indent, start) {
    const lines = node.value.split(/\r\n|\n|\r/);
    for (let i = 0; i < lines.length; i++) {
      const match = htmlHeading.exec(lines[i]);
      if (!match) continue;
      const level = Number(match[1]);
      const closing = new RegExp(`</h${level}>`, 'i');
      const line = start + i;
      let text = match[2];
      let end = i;
      if (!closing.test(text)) {
        let pending = text;
        for (let j = i + 1; j < lines.length && j - i <= htmlLookahead; j++) {
          pending += `\n${lines[j]}`;
          if (closing.test(pending)) {
            text = pending;
            end = j;
            break;
          }
        }
      }
      addHeading(level, normalizeLabel(text.replace(/<[^>]*>/g, '')), line, indent);
      // An unclosed heading can make the parser consume the rest of the block as HTML.
      if (!closing.test(text) && end === i && i + 1 < lines.length) {
        visit(parseMarkdownBlocks(lines.slice(i + 1).join('\n')), indent, line);
        return;
      }
      i = end;
    }
  }

  function visit(nodes, indent, offset) {
    for (const node of nodes) {
      const line = node.position.start.line + offset;
      if (node.type === 'heading') {
        addHeading(node.depth, normalizeLabel(labelOf(node)), line, indent);
      } else if (node.type === 'list') {
        node.children.forEach((item, index) => {
          const label = item.children[0];
          const text = label?.type === 'paragraph' ? normalizeLabel(labelOf(label)) : '';
          const entry = {
            type: node.ordered ? 'list-ordered' : 'list-unordered',
            indent,
            ...(node.ordered ? { order: (node.start ?? 1) + index } : {}),
            ...(typeof item.checked === 'boolean'
              ? { checked: item.checked, taskState: tasks.get(item) ?? String(item.checked) }
              : {}),
            text,
            line: item.position.start.line + offset,
            parentLevel: currentHeadingLevel,
          };
          items.push(entry);
          const section = currentHeadingLevel;
          const firstChild = items.length;
          visit(item.children, indent + 1, offset);
          currentHeadingLevel = section;
          if (items.length > firstChild) entry.endLine = item.position.end.line + offset;
          else if (!text && entry.taskState == null) items.pop();
        });
      } else if (node.type === 'html') {
        visitHtml(node, indent, line);
      } else if (node.type === 'blockquote' || node.type === 'footnoteDefinition') {
        const section = currentHeadingLevel;
        visit(node.children, indent + 1, offset);
        currentHeadingLevel = section;
      }
    }
  }
  visit(blocks, 0, 0);
  return items;
}

// Each top-level heading is pushed/popped once. Long lists no longer scan backwards
// through every preceding list item to find their collapsed ancestors.
export function outlineRows(items, collapsed) {
  const ancestors = [];
  const lists = [];
  // Keep running counts instead of scanning every ancestor/list for each row:
  // long lists otherwise make this O(n²).
  let collapsedAncestors = 0;
  let collapsedLists = 0;
  return items.map((item, index) => {
    const section = item.type === 'heading' && !item.indent;
    if (section) {
      while (ancestors.length && ancestors.at(-1).level >= item.level) {
        const popped = ancestors.pop();
        if (collapsed[popped.index]) collapsedAncestors -= 1;
      }
    }
    while (lists.length && item.line > lists.at(-1).endLine) {
      const popped = lists.pop();
      if (collapsed[popped.index]) collapsedLists -= 1;
    }
    const hidden = collapsedAncestors > 0 || collapsedLists > 0;
    const next = items[index + 1];
    const canCollapse =
      item.endLine != null ||
      (section &&
        Boolean(next) &&
        (next.type !== 'heading' || next.indent > 0 || next.level > item.level));
    const parent = lists.at(-1)?.index ?? ancestors.at(-1)?.index;
    if (section) {
      ancestors.push({ level: item.level, index });
      if (collapsed[index]) collapsedAncestors += 1;
    }
    if (item.endLine != null) {
      lists.push({ index, endLine: item.endLine });
      if (collapsed[index]) collapsedLists += 1;
    }
    return { item, index, parent, hidden, canCollapse };
  });
}
