import { resolveMarkdownAssetPath } from './markdownAssets';

const ALIASES = { js: 'javascript', ts: 'typescript', py: 'python', cs: 'csharp', 'c#': 'csharp', 'c++': 'cpp', sh: 'bash', shell: 'bash', yml: 'yaml', md: 'markdown', rb: 'ruby', rs: 'rust' };
export const normalizeCodeLanguage = (language = '') => ALIASES[language.toLowerCase()] || language.toLowerCase();

// Retain source lines, and ignore fence-looking text inside another fence.
export function markdownFences(source = '') {
  const blocks = [];
  let open = null;
  source.split(/\r?\n/).forEach((line, index) => {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (open) {
      if (match && match[1][0] === open.marker[0] && match[1].length >= open.marker.length && !match[2].trim()) {
        blocks.push({ ...open, source: open.lines.join('\n') });
        open = null;
      } else open.lines.push(line);
    } else if (match && !(match[1][0] === '`' && match[2].includes('`'))) {
      open = { marker: match[1], language: match[2].trim().split(/\s/)[0].toLowerCase(), line: index + 1, lines: [] };
    }
  });
  if (open) blocks.push({ ...open, source: open.lines.join('\n') });
  return blocks;
}

export function treeReference(source) {
  const match = source.trim().match(/^@tree\((.+)\)$/);
  if (!match) return null;
  const path = match[1].trim().replace(/^(['"])(.*)\1$/, '$2');
  return /\.mgtree$/i.test(path) ? path : `${path}.mgtree`;
}

export function companionTreePaths(documentPath, source) {
  if (!documentPath || documentPath.startsWith('content://')) return [];
  const base = documentPath.split(/[\\/]/).pop().replace(/\.(md|markdown|mdx)$/i, '');
  // Headings are filenames only; never let heading text traverse directories.
  const heading = source.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1]?.replace(/[*`_]/g, '').trim();
  const names = [base, heading].filter((name) => name && !/[\\/:*?"<>|]/.test(name));
  return [...new Set(names.flatMap((name) => [`${name}.mgtree`, `trees/${name}.mgtree`])
    .map((path) => resolveMarkdownAssetPath(path, documentPath)))];
}

export function findCodeBlock(container, language, index) {
  if (!container || !Number.isSafeInteger(index) || index < 1) return null;
  const normalized = normalizeCodeLanguage(language);
  return [...container.querySelectorAll('pre[data-code-language]')]
    .filter((pre) => pre.dataset.codeLanguage === normalized)[index - 1] || null;
}
