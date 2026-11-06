// Generate open variants from the local SVG folder base, preserving each motif.
import { readFileSync, writeFileSync } from 'node:fs';
const names = ['folder-csharp', 'folder-mvn', 'mysql', 'tomcat', 'en', 'zh', 'users', 'user'];
for (const name of names) {
  const source = new URL(`../src/assets/file-icons/${name}.svg`, import.meta.url);
  const svg = readFileSync(source, 'utf8');
  const open = svg.replace(/<path id="folder" fill="([^"]+)" d="[^"]+"\s*\/>/, (_, color) =>
    `<path id="folder-back" fill="${color}" opacity=".65" d="M1 12V4a1 1 0 0 1 1-1h3.64a1 1 0 0 1 .64.23L7.56 4H14a1 1 0 0 1 1 1v7Z"/><path id="folder" fill="${color}" d="M2.5 6h12a.75.75 0 0 1 .73.94l-1.3 5.3A1 1 0 0 1 12.96 13H2.05a1 1 0 0 1-.98-1.2l.7-5.15A.75.75 0 0 1 2.5 6Z"/>`);
  if (open === svg) throw new Error(`Missing folder base: ${name}`);
  writeFileSync(new URL(`../src/assets/file-icons/${name}-open.svg`, import.meta.url), open);
}
