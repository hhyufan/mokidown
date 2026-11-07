// Generate open variants from the local SVG folder base, preserving each motif.
import { readFileSync, writeFileSync } from 'node:fs';
const names = ['folder-csharp', 'folder-mvn', 'mysql', 'tomcat', 'en', 'zh', 'users', 'user'];
for (const name of names) {
  const source = new URL(`../src/assets/file-icons/${name}.svg`, import.meta.url);
  const svg = readFileSync(source, 'utf8');
  const open = svg.replace(/<path id="folder" fill="([^"]+)" d="[^"]+"\s*\/>/, (_, color) => [
    `<path id="folder-back" fill="${color}" d="M1 12.4V4a1 1 0 0 1 1-1h3.65c.23 0 .46.08.64.23L7.5 4h5.75a1 1 0 0 1 1 1v1.1l-2.9 7.3H2a1 1 0 0 1-1-1Z"/>`,
    '<path id="folder-interior" fill="#fff" d="M2.2 12.15V5.9c0-.5.4-.9.9-.9h11.15v1.09l-2.6 6.06Z"/>',
    `<path id="folder" fill="${color}" d="M1 12.4h1.2l1.95-5.64a1 1 0 0 1 .94-.67h9.4a.8.8 0 0 1 .73 1.12l-2.45 5.59a1 1 0 0 1-.92.6H2a1 1 0 0 1-1-1Z"/>`,
  ].join(''));
  if (open === svg) throw new Error(`Missing folder base: ${name}`);
  writeFileSync(new URL(`../src/assets/file-icons/${name}-open.svg`, import.meta.url), open);
}
