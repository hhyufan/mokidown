import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { ProjectTreeModel, PROJECT_CACHE_PAGES } from './projectTreeModel';
import { parentDirectory } from './explorerPaths';

const folder = (path) => ({ path, name: path.split('/').pop(), is_dir: true });
const file = (path) => ({ path, name: path.split('/').pop(), is_dir: false });
let models;
function tree(options = {}) {
  const model = new ProjectTreeModel({ root: folder('/root'), onChange: vi.fn(), ...options });
  models.push(model); return model;
}
beforeEach(() => {
  models = [];
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => { for (const model of models) model.dispose(); vi.unstubAllGlobals(); });

it('represents ten million children sparsely and reads only the requested pages', async () => {
  const read = vi.fn(async (page) => Array.from({ length: 256 }, (_, i) => file(`/root/n${page * 256 + i}.md`)));
  const model = tree({ source: { total: 10_000_000, pageSize: 256, read } });
  expect(model.count).toBe(10_000_001);
  expect(model.root.branches).toHaveLength(0);
  expect(model.get(10_000_000)).toMatchObject({ index: 9_999_999, file: undefined });
  model.ensureRange(9_999_980, 10_000_001);
  await vi.waitFor(() => expect(model.get(10_000_000).file?.name).toBe('n9999999.md'));
  expect(read).toHaveBeenCalledTimes(1);
  expect(model.pages.size).toBeLessThanOrEqual(PROJECT_CACHE_PAGES);
});

it('reveals nested results using direct child positions without flattening the tree', async () => {
  const close = vi.fn();
  const openDirectory = vi.fn((path) => ({ owned: true, close, ready: Promise.resolve({
    total: 1, items: path.endsWith('/src') ? [folder('/root/src/nested')] : [file('/root/src/nested/README.md')],
  }) }));
  const model = tree({ items: [folder('/root/src'), file('/root/z.md')], openDirectory });
  const position = await model.reveal(file('/root/src/nested/README.md'));
  expect(position).toBe(3);
  expect(model.get(position).file.name).toBe('README.md');
  expect(model.count).toBe(5);
  expect(openDirectory).toHaveBeenCalledTimes(2);
  model.collapseAll();
  expect(model.count).toBe(1);
  expect(close).toHaveBeenCalledTimes(2);
  expect(model.get(1)).toBeNull();
});

it('locates off-cache results in disk-backed directories and cancels stale reveals', async () => {
  const source = { total: 10_000_000, pageSize: 256, locate: vi.fn(async () => 9_999_999),
    read: vi.fn(async () => Array.from({ length: 128 }, (_, i) => file(`/root/n${9_999_872 + i}.md`))) };
  const model = tree({ source });
  const result = file('/root/n9999999.md');
  expect(await model.reveal(result, () => false)).toBeNull();
  expect(source.locate).not.toHaveBeenCalled();
  expect(await model.reveal(result)).toBe(10_000_000);
  expect(model.get(10_000_000).file.path).toBe(result.path);
  expect(source.read).toHaveBeenCalledExactlyOnceWith(39062);
});

it('retries a failed expansion and ignores an expansion completed after collapse', async () => {
  let finish;
  const close = vi.fn();
  const openDirectory = vi.fn()
    .mockReturnValueOnce({ owned: true, close, ready: Promise.reject(new Error('denied')) })
    .mockReturnValueOnce({ owned: true, close, ready: Promise.resolve({ total: 1, items: [file('/root/src/a.md')] }) })
    .mockReturnValueOnce({ owned: true, close, ready: new Promise((resolve) => { finish = resolve; }) });
  const model = tree({ items: [folder('/root/src')], openDirectory });
  const node = model.toggle(model.get(1));
  await node.ready;
  expect(model.get(2).status).toBe('error');
  await model.retry(node);
  expect(model.get(2).file.name).toBe('a.md');
  model.collapseAll();
  model.toggle(model.get(0));
  const late = model.toggle(model.get(1));
  model.collapseAll(); finish({ total: 99, items: [] }); await late.ready;
  expect(model.count).toBe(1);
  expect(model.root.branches).toHaveLength(0);
});

it('recursively expands selected folders, including already open descendants', async () => {
  const listings = {
    '/root/src': [folder('/root/src/one'), folder('/root/src/two'), file('/root/src/code.js')],
    '/root/src/one': [folder('/root/src/one/deep')],
    '/root/src/one/deep': [file('/root/src/one/deep/end.md')],
    '/root/src/two': [],
  };
  const model = tree({ items: [folder('/root/src')], openDirectory: (path) => ({ ready: Promise.resolve({ items: listings[path], total: listings[path].length }) }) });
  await model.expandDescendants(folder('/root/src'));
  const rows = Array.from({ length: model.count }, (_, index) => model.get(index));
  expect(rows.some((row) => row.file?.path === '/root/src/one/deep/end.md')).toBe(true);
  for (const row of rows.filter((row) => row.file?.is_dir)) expect(row.node?.expanded).toBe(true);
  expect(model.pages.size).toBe(0);
});

it('Collapse all cancels a recursive expansion waiting for directory IO', async () => {
  let resolve;
  const model = tree({ items: [folder('/root/src')], openDirectory: () => ({ ready: new Promise((done) => { resolve = done; }) }) });
  const expanding = model.expandDescendants(folder('/root/src'));
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  model.collapseAll();
  resolve({ total: 1, items: [folder('/root/src/nested')] });
  await expanding;
  expect(model.root.branches).toHaveLength(0);
  expect(model.count).toBe(1);
});

it('stops recursive folder links when their canonical directory repeats', async () => {
  const model = tree({ items: [folder('/root/src')], openDirectory: (path) => ({ ready: Promise.resolve({
    canonicalPath: '/real/src', total: 1, items: [folder(`${path}/link`)],
  }) }) });
  await model.expandDescendants(folder('/root/src'));
  expect(model.count).toBe(3);
  expect(model.get(2).node.expanded).toBe(false);
});

it('empty and pending folders do not introduce placeholder rows', async () => {
  let resolve;
  const model = tree({ items: [folder('/root/empty')], openDirectory: () => ({ ready: new Promise((done) => { resolve = done; }) }) });
  const empty = model.toggle(model.get(1));
  expect(model.count).toBe(2);
  resolve({ total: 0, items: [] }); await empty.ready;
  expect(model.count).toBe(2);
  expect(model.get(2)).toBeNull();
  expect(model.isEmpty('/root/empty')).toBe(true);
});

it('inserts the filename draft after the selected directory children and expands it first', async () => {
  const model = tree({ items: [folder('/root/src'), file('/root/z.md')], openDirectory: () => ({ ready: Promise.resolve({
    total: 2, items: [file('/root/src/a.md'), file('/root/src/b.md')],
  }) }) });
  expect(await model.startDraft(folder('/root/src'))).toBe(4);
  expect(model.get(3).file.name).toBe('b.md');
  expect(model.get(4)).toMatchObject({ draft: true, depth: 2 });
  expect(model.get(5).file.name).toBe('z.md');
  model.cancelDraft();
  expect(model.draftPosition).toBe(-1);
  expect(model.get(1).node).toBeNull();
  expect(model.get(2).file.name).toBe('z.md');
  await model.startDraft(folder('/root/src'));
  model.collapseAll();
  expect(model.draft).toBeNull();
  expect(model.count).toBe(1);
});

it('places a draft at the root end when no child directory has been selected', async () => {
  const model = tree({ items: [file('/root/a.md'), file('/root/b.md')] });
  expect(await model.startDraft(folder('/root'))).toBe(3);
  expect(model.get(2).file.name).toBe('b.md');
  expect(model.get(3).draft).toBe(true);
});

it('a fresh child result overrides the parent snapshot state after collapsing it', async () => {
  const entry = { ...folder('/root/empty'), directoryState: 'empty' };
  const model = tree({ items: [entry], openDirectory: () => ({ ready: Promise.resolve({ total: 1, items: [file('/root/empty/new.md')] }) }) });
  expect(model.directoryStateOf(entry)).toBe('empty');
  const node = model.toggle(model.get(1));
  await node.ready;
  model.collapse(node);
  expect(model.directoryStateOf(model.get(1).file)).toBe('readable');
});

it('cancels an empty-folder draft back to a closed empty folder', async () => {
  const entry = { ...folder('/root/empty'), directoryState: 'empty' };
  const close = vi.fn();
  const model = tree({ items: [entry], openDirectory: () => ({ owned: true, close, ready: Promise.resolve({ total: 0, items: [] }) }) });
  expect(await model.startDraft(entry)).toBe(2);
  expect(model.get(1).node.expanded).toBe(true);
  model.cancelDraft();
  expect(model.draft).toBeNull(); expect(model.draftSession).toBeNull();
  expect(model.count).toBe(2);
  expect(model.get(1).node).toBeNull();
  expect(model.directoryStateOf(entry)).toBe('empty');
  expect(close).toHaveBeenCalledOnce();
});

it('rolls back a denied new-file target and leaves its error indicator available', async () => {
  const entry = folder('/root/denied'), close = vi.fn();
  const model = tree({ items: [entry], openDirectory: () => ({ owned: true, close, ready: Promise.reject(new Error('Access denied')) }) });
  await expect(model.startDraft(entry)).rejects.toThrow('Access denied');
  expect(model.draft).toBeNull(); expect(model.draftSession).toBeNull();
  expect(model.root.branches).toHaveLength(0);
  expect(model.directoryStateOf(entry)).toBe('unreadable');
  expect(close).toHaveBeenCalledOnce();
});

it('ignores a superseded draft preparation and keeps only the newer draft', async () => {
  const resolvers = [], close = vi.fn(), entry = folder('/root/empty');
  const model = tree({ items: [entry], openDirectory: () => ({ owned: true, close, ready: new Promise((resolve) => resolvers.push(resolve)) }) });
  const first = model.startDraft(entry);
  await vi.waitFor(() => expect(resolvers).toHaveLength(1));
  const second = model.startDraft(entry);
  await vi.waitFor(() => expect(resolvers).toHaveLength(2));
  resolvers[0]({ items: [], total: 0 }); resolvers[1]({ items: [], total: 0 });
  expect(await first).toBeNull(); expect(await second).toBe(2);
  expect(model.root.branches).toHaveLength(1);
  expect(model.draft.node.disposed).toBe(false);
});

it.each([
  ['C:\\', ''], ['C:\\notes', 'C:\\'], ['C:\\notes\\src', 'C:\\notes'],
  ['/', ''], ['/notes', '/'], ['/notes/src', '/notes'],
  ['\\\\server\\share', ''], ['\\\\server\\share\\notes', '\\\\server\\share'],
  ['web://picked', ''], ['web://picked/src', 'web://picked'],
  ['content://provider/tree/root', ''],
])('determines the real parent boundary for %s', (path, expected) => {
  expect(parentDirectory(path)).toBe(expected);
});

it('remembers denied and empty folders after they are collapsed', async () => {
  const openDirectory = vi.fn((path) => {
    if (path.endsWith('/denied')) return { ready: Promise.reject(new Error('access denied')) };
    if (path.endsWith('/empty')) return { ready: Promise.resolve({ total: 0, items: [] }) };
    return { ready: Promise.resolve({ total: 1, items: [file(`${path}/a.md`)] }) };
  });
  const model = tree({ items: [folder('/root/denied'), folder('/root/empty')], openDirectory });
  const denied = model.toggle(model.get(1));
  await denied.ready.catch(() => {});
  expect(model.failureOf('/root/denied')).toContain('access denied');
  expect(model.isEmpty('/root/denied')).toBe(false);
  model.toggle(model.get(1));
  expect(model.failureOf('/root/denied')).toContain('access denied');

  const empty = model.toggle(model.get(2));
  await empty.ready;
  expect(model.isEmpty('/root/empty')).toBe(true);
  model.toggle(model.get(2));
  expect(model.isEmpty('/root/empty')).toBe(true);
});
