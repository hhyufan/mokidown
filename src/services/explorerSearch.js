import { getDirectoryContents, searchFiles, cancelSearch } from '@utils/tauriApi';
import { usesDirectoryIndex } from './workspaceFiles';

let sequence = 0;
export function searchExplorerNames(root, query, { caseSensitive = false, recursive = true } = {}) {
  const id = `explorer-search-${Date.now()}-${++sequence}`;
  let cancelled = false;
  const native = usesDirectoryIndex(root);
  const promise = native ? searchFiles(root, query, false, 1000, id, {
    caseSensitive, includeExcluded: true, filenameOnly: true, includeFolders: true, recursive,
  }) : (async () => {
    const results = [], pending = [{ path: root, ancestors: [] }], seen = new Set();
    const needle = caseSensitive ? query : query.toLowerCase();
    let skippedFiles = 0;
    while (pending.length && !cancelled) {
      const { path, ancestors } = pending.pop();
      if (seen.has(path)) continue;
      seen.add(path);
      let entries;
      try { entries = await getDirectoryContents(path); }
      catch (error) { if (path === root) throw error; skippedFiles++; continue; }
      for (const file of entries) {
        if (cancelled) break;
        if ((caseSensitive ? file.name : file.name.toLowerCase()).includes(needle)) {
          if (results.length === 1000) return { results, truncated: true, skippedFiles };
          results.push({ ...file, ancestors });
        }
        if (recursive && file.is_dir) pending.push({ path: file.path, ancestors: [...ancestors, file.path] });
      }
    }
    return { results, truncated: false, skippedFiles };
  })();
  return { promise, cancel: () => { cancelled = true; if (native) void cancelSearch(id).catch(() => {}); } };
}
