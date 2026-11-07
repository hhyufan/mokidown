// Generate open variants from the local SVG folder base, preserving each motif.
import { readFileSync, writeFileSync } from 'node:fs';
const names = ['folder-csharp', 'folder-mvn', 'mysql', 'tomcat', 'en', 'zh', 'users', 'user'];
for (const name of names) {
  const source = new URL(`../src/assets/file-icons/${name}.svg`, import.meta.url);
  const svg = readFileSync(source, 'utf8');
  const open = svg.replace(/<path id="folder" fill="([^"]+)" d="[^"]+"\s*\/>/, (_, color) =>
    `<path id="folder-back" fill="${color}" opacity=".7" d="M1 12V4a1 1 0 0 1 1-1h3.65c.23 0 .46.08.64.23L7.5 4h5.75a1 1 0 0 1 1 1v1H4.9a1 1 0 0 0-.94.66L2.1 12Z"/><path id="folder" fill="${color}" d="M1 12.3a1 1 0 0 0 1 1.2h10.1a1 1 0 0 0 .92-.61l2.4-5.63a.7.7 0 0 0-.64-.98H5.15a1 1 0 0 0-.93.64L2 12.3Z"/>`);
  if (open === svg) throw new Error(`Missing folder base: ${name}`);
  writeFileSync(new URL(`../src/assets/file-icons/${name}-open.svg`, import.meta.url), open);
}
