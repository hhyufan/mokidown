const TAGS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect', 'title', 'desc']);
const ATTRS = new Set(['xmlns', 'viewbox', 'width', 'height', 'd', 'points', 'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'opacity', 'transform', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'role', 'aria-label']);
export function sanitizePluginSvg(input) {
  const svg = String(input || '');
  if (!svg || svg.length > 4096) throw new Error('Invalid SVG icon');
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg' || doc.doctype) throw new Error('Invalid SVG icon');
  for (const node of [doc.documentElement, ...doc.documentElement.querySelectorAll('*')]) {
    if (!TAGS.has(node.localName)) throw new Error('Unsupported SVG element');
    for (const attr of node.attributes) if (!ATTRS.has(attr.name.toLowerCase()) || /url\s*\(|javascript:|data:/i.test(attr.value)) throw new Error('Unsupported SVG attribute');
  }
  return new XMLSerializer().serializeToString(doc.documentElement);
}
