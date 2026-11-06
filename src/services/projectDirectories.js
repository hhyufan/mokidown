import { closeDirectoryIndex, getDirectoryContents, openDirectoryIndex, readDirectoryPage, locateDirectoryEntry } from '@utils/tauriApi';
import { sortDirectoryContents } from '@utils/directoryContents';
import { usesDirectoryIndex } from './workspaceFiles';

let generation = 0;
let session = 0;

// Browser/SAF providers keep their existing listing API. Bound the direct-child
// checks and annotate a copy so file mode's store contents are not mutated.
export async function inspectProjectChildren(items, isCurrent = () => true) {
  const result = [...items];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (isCurrent() && cursor < items.length) {
      const index = cursor++, file = items[index];
      if (!file.is_dir) continue;
      try {
        const children = await getDirectoryContents(file.path);
        if (isCurrent()) result[index] = { ...file, directoryState: children.length ? 'readable' : 'empty' };
      } catch (error) {
        if (isCurrent()) result[index] = { ...file, directoryState: 'unreadable', directoryError: String(error) };
      }
    }
  }));
  return result;
}

export function projectDirectoryProvider({ sortBy, sortOrder }) {
  const prefix = `project-${Date.now()}-${++session}`;
  return (path) => {
    if (!usesDirectoryIndex(path)) {
      let active = true;
      return { owned: true, close: () => { active = false; }, ready: getDirectoryContents(path).then(async (entries) => {
        const items = await inspectProjectChildren(sortDirectoryContents(entries, { sortBy, sortOrder }), () => active);
        return { items, total: items.length };
      }) };
    }
    generation = Math.max(generation + 1, Date.now() * 1000);
    const id = `directory-${generation}`;
    const scope = `${prefix}:${path}`;
    return {
      id, scope, owned: true, pageSize: 256,
      ready: openDirectoryIndex(id, path, sortBy, sortOrder, scope),
      read: (page) => readDirectoryPage(id, page * 256, 256, scope),
      locate: (path) => locateDirectoryEntry(id, path, scope),
      close: () => closeDirectoryIndex(id, scope),
    };
  };
}

export function projectRootSource(snapshot) {
  if (!snapshot) return null;
  return { ...snapshot, owned: false,
    read: (page) => readDirectoryPage(snapshot.id, page * snapshot.pageSize, snapshot.pageSize),
    locate: (path) => locateDirectoryEntry(snapshot.id, path),
  };
}
