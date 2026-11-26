function labelOf(element) {
  if (!element.matches('li')) return element.textContent;
  const label = listLabel(element);
  if (label) return label.textContent;
  return [...element.childNodes]
    .filter((node) => !node.matches?.('ol, ul, .md-preview__fold, input'))
    .map((node) => node.textContent)
    .join('');
}

function listLabel(element) {
  return element.querySelector(':scope > p:first-of-type, :scope > .md-preview__task-label');
}

export function outlineHighlightTarget(element) {
  return element?.matches('li') ? listLabel(element) ?? element : element;
}

const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
const omittedContainers = '.milkdown-code-block, .knowledge-tree, pre';

export function findOutlineDomTarget(root, { line, level, text, type }) {
  if (!root) return null;
  const selector = type === 'heading'
    ? (Number.isInteger(level) && level >= 1 && level <= 6 ? `h${level}` : 'h1,h2,h3,h4,h5,h6')
    : type === 'list-ordered' ? 'ol > li' : 'ul > li';
  if (Number.isSafeInteger(line) && line > 0) {
    const exact = root.querySelector(`:is(${selector})[data-outline-line="${line}"]`);
    if (exact && !exact.closest(omittedContainers)) return exact;
  }
  const label = normalize(text);
  if (!label) return null;
  const elements = [...root.querySelectorAll(selector)].filter((element) =>
    !element.closest(omittedContainers),
  );
  return elements.find((element) => normalize(labelOf(element)) === label)
    ?? elements.find((element) => normalize(labelOf(element)).startsWith(label))
    ?? null;
}
