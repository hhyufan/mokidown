// Keep authored title metadata on a data attribute so React updates/removes it
// normally, while the delegated Antd tooltip renders the visual hint.
export default function rehypeTooltipTitles() {
  return (tree) => {
    const visit = (node) => {
      if (node.type === 'element' && node.tagName !== 'iframe' && node.properties?.title != null) {
        node.properties['data-moki-tooltip'] = node.properties.title;
        delete node.properties.title;
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
