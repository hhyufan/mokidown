import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

// Close a heading at the next heading of equal or higher rank.
export function headingSections(blocks, documentEnd) {
  const sections = [];
  const open = [];
  for (const block of blocks) {
    if (!block.level) continue;
    while (open.length && open.at(-1).level >= block.level) open.pop().end = block.start;
    const section = { ...block, end: documentEnd };
    sections.push(section);
    open.push(section);
  }
  return sections;
}

export function markdownFoldingRanges(source) {
  const blocks = parser.parse(source).children;
  const headings = blocks.filter((node) => node.type === 'heading').map((node) => ({
    level: node.depth, start: node.position.start.line, headingEnd: node.position.end.line,
  }));
  const end = source.split('\n').length + 1;
  const sections = headingSections(headings, end)
    .filter(({ headingEnd, end: sectionEnd }) => headingEnd < sectionEnd - 1)
    .map(({ start, end: sectionEnd }) => ({ start, end: sectionEnd - 1 }));
  const ranges = [...sections];
  const visit = (nodes) => {
    for (const node of nodes) {
      const { start, end } = node.position;
      if ((node.type === 'code' && end.line > start.line) ||
        (node.type === 'listItem' && node.children.some((child) => child.type === 'list'))) {
        ranges.push({ start: start.line, end: end.line });
      }
      if (node.children) visit(node.children);
    }
  };
  visit(blocks);
  return ranges;
}

const isList = (node) => node.tagName === 'ol' || node.tagName === 'ul';
const foldMarker = () => ({ type: 'element', tagName: 'span',
  properties: { className: ['md-preview__fold-ellipsis'], ariaHidden: 'true' },
  children: [] });

// React Markdown renders from source positions. Retain them outside the
// content elements so folded blocks and custom renderers share the same map.
export function rehypeMarkdownSections() {
  return (tree) => {
    const blocks = tree.children.filter((node) => node.type === 'element' || (node.type === 'text' && node.value.trim()));
    const sections = new Map(headingSections(blocks.map((node, index) => ({
      level: /^h[1-6]$/.test(node.tagName) ? Number(node.tagName[1]) : 0,
      start: index,
    })), blocks.length).map((section) => [section.start, section.end]));
    function prepareLists(node) {
      if (!node.children) return;
      for (const child of node.children) {
        prepareLists(child);
        if (!isList(node) || child.tagName !== 'li' || !child.position) continue;
        const list = child.children.findIndex(isList);
        if (list < 0) continue;
        const label = child.children.find((item) => item.tagName === 'p' || item.properties?.className?.includes('md-preview__task-label'));
        if (label) label.children.push(foldMarker());
        else child.children.splice(list, 0, foldMarker());
        child.properties.className = [...(child.properties.className || []), 'md-preview__foldable-item'];
        child.properties.dataMdItem = child.position.start.line;
      }
    }

    tree.children = blocks.map((node, index) => {
      prepareLists(node);
      const end = sections.get(index);
      const fold = end > index + 1 ? end : undefined;
      const code = node.tagName === 'pre' && node.position?.start.line < node.position?.end.line;
      const language = code && node.children.find((child) => child.tagName === 'code')?.properties.className
        ?.find((name) => name.startsWith('language-'))?.slice(9);
      if (fold) {
        node.properties.dataMdHeading = node.position?.start.line;
        node.children.push(foldMarker());
      }
      return {
        type: 'element', tagName: 'div',
        properties: {
          className: ['md-preview__source-block', ...(code ? ['md-preview__foldable-code'] : [])],
          dataMdStart: node.position?.start.line,
          dataMdEnd: node.position?.end.line,
          dataMdFold: fold,
          dataMdCode: code ? language || '' : undefined,
        },
        children: [node],
      };
    });
  };
}
