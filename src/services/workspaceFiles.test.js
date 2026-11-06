import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import useFileStore from '@store/useFileStore';
import { openDirectoryIndex, closeDirectoryIndex, readDirectoryPage, getDirectoryContents } from '@utils/tauriApi';
import { DIRECTORY_CACHE_PAGES, ensureDirectoryRange, getIndexedFile, loadWorkspaceFiles } from './workspaceFiles';

vi.mock('@utils/tauriApi', () => ({
  isSafUri: (path) => path.startsWith('content:'),
  openDirectoryIndex: vi.fn(), closeDirectoryIndex: vi.fn(), readDirectoryPage: vi.fn(), getDirectoryContents: vi.fn(),
}));
let frames;
let frameId;
const microtasks = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
const tick = async () => {
  await microtasks();
  const callbacks = [...frames.values()]; frames.clear();
  callbacks.forEach((callback) => callback(performance.now()));
  await microtasks();
};
beforeEach(() => {
  useFileStore.getState().clearDirectory();
  vi.clearAllMocks();
  vi.stubGlobal('__TAURI_INTERNALS__', {});
  frames = new Map(); frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id) => frames.delete(id));
  useFileStore.setState({ sortBy: 'name', sortOrder: 'asc' });
  closeDirectoryIndex.mockResolvedValue();
  openDirectoryIndex.mockImplementation(async (id) => ({ id, total: 10_000_000, pageSize: 256 }));
  readDirectoryPage.mockImplementation(async (_id, offset, limit) => Array.from({ length: limit }, (_, i) => ({ name: `note${offset + i}.md`, path: `/notes/note${offset + i}.md` })));
});
afterEach(() => { useFileStore.getState().clearDirectory(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps a ten-million-entry listing as a snapshot, fetching only visible pages with a fixed cache budget', async () => {
  await loadWorkspaceFiles('/notes', { navigate: true });
  expect(getDirectoryContents).not.toHaveBeenCalled();
  expect(useFileStore.getState().files).toHaveLength(0);
  for (let page = 0; page < DIRECTORY_CACHE_PAGES + 5; page += 1) {
    ensureDirectoryRange(page * 256, page * 256 + 20);
    await tick();
  }
  const index = useFileStore.getState().directoryIndex;
  expect(index.total).toBe(10_000_000);
  expect(index.pages.size).toBe(DIRECTORY_CACHE_PAGES);
  expect(getIndexedFile(index, 20 * 256).name).toBe(`note${20 * 256}.md`);
  expect(getIndexedFile(index, 0)).toBeUndefined();
  expect(readDirectoryPage.mock.calls.every((args) => args[2] === 256)).toBe(true);
});

it('coalesces fast scrolling to the latest viewport while one page is in flight', async () => {
  let finish;
  await loadWorkspaceFiles('/notes', { navigate: true });
  readDirectoryPage.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  ensureDirectoryRange(0, 20);
  for (let i = 1; i <= 1000; i += 1) ensureDirectoryRange(i * 256, i * 256 + 20);
  expect(readDirectoryPage).toHaveBeenCalledTimes(2);
  finish([{ name: 'first' }]);
  await tick();
  expect(readDirectoryPage).toHaveBeenCalledTimes(3);
  expect(readDirectoryPage.mock.calls[2][1]).toBe(1000 * 256);
  expect(useFileStore.getState().directoryIndex.pages.has(0)).toBe(false);
});

it('cancels old builds on navigation and close, and rejects stale pages', async () => {
  let finish;
  openDirectoryIndex.mockImplementationOnce((id) => new Promise((resolve) => { finish = () => resolve({ id, total: 10, pageSize: 256 }); }));
  const pending = loadWorkspaceFiles('/old', { navigate: true });
  await loadWorkspaceFiles('/notes', { navigate: true });
  finish(); await pending;
  expect(useFileStore.getState().directoryIndex.path).toBe('/notes');
  expect(closeDirectoryIndex).toHaveBeenCalledWith(openDirectoryIndex.mock.calls[0][0]);
  readDirectoryPage.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  ensureDirectoryRange(0, 20);
  useFileStore.getState().clearDirectory();
  finish([{ name: 'stale' }]); await tick();
  expect(useFileStore.getState().directoryIndex).toBeNull();
  expect(useFileStore.getState().directoryLoading).toBe(false);
});

it('rebuilds sorted native snapshots without advancing navigation history', async () => {
  await loadWorkspaceFiles('/notes', { navigate: true });
  const history = useFileStore.getState().dirHistory;
  useFileStore.getState().setSortOrder('desc');
  await tick();
  expect(openDirectoryIndex).toHaveBeenLastCalledWith(expect.any(String), '/notes', 'name', 'desc');
  expect(useFileStore.getState().directoryIndex.sortOrder).toBe('desc');
  expect(useFileStore.getState().dirHistory).toBe(history);
});

it('reports indexing and page failures without retaining loading state or retrying forever', async () => {
  openDirectoryIndex.mockRejectedValueOnce(new Error('Access denied'));
  await expect(loadWorkspaceFiles('/notes', { navigate: true })).rejects.toThrow('Access denied');
  expect(useFileStore.getState().directoryLoading).toBe(false);
  expect(useFileStore.getState().directoryError).toContain('Access denied');
  await loadWorkspaceFiles('/notes');
  readDirectoryPage.mockRejectedValueOnce(new Error('Disk error'));
  ensureDirectoryRange(0, 20); await tick();
  expect(readDirectoryPage).toHaveBeenCalledTimes(1);
  expect(useFileStore.getState().directoryError).toContain('Disk error');
});

it('preserves sorted SAF/browser lists and discards reads completed after closing', async () => {
  getDirectoryContents.mockResolvedValue([{ name: 'note10' }, { name: 'note2' }]);
  await loadWorkspaceFiles('content://notes', { navigate: true });
  expect(useFileStore.getState().files.map((file) => file.name)).toEqual(['note2', 'note10']);
  let finish;
  getDirectoryContents.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = loadWorkspaceFiles('content://notes');
  useFileStore.getState().clearDirectory();
  finish([{ name: 'stale' }]); await pending;
  expect(useFileStore.getState().files).toHaveLength(0);
});

it('loads actually visible pages before offscreen render buffers and publishes completions in one frame', async () => {
  await loadWorkspaceFiles('/notes', { navigate: true });
  let updates = 0;
  const stop = useFileStore.subscribe((state, previous) => { if (state.directoryIndex !== previous.directoryIndex) updates += 1; });
  ensureDirectoryRange(250, 550, { visibleStart: 500, visibleEnd: 520, direction: 1, velocity: 32 });
  expect(readDirectoryPage.mock.calls.slice(0, 2).map((call) => call[1])).toEqual([256, 512]);
  await microtasks();
  expect(updates).toBe(0);
  expect(frames.size).toBe(1);
  await tick();
  expect(updates).toBe(1);
  expect(getIndexedFile(useFileStore.getState().directoryIndex, 500).name).toBe('note500.md');
  stop();
});

it('keeps an urgent slot free when prefetch is slow and discards an obsolete prefetch result', async () => {
  await loadWorkspaceFiles('/notes', { navigate: true });
  let finishPrefetch;
  readDirectoryPage.mockImplementation(async (_id, offset) => {
    if (offset === 256) return new Promise((resolve) => { finishPrefetch = resolve; });
    return [{ name: `note${offset}.md` }];
  });
  ensureDirectoryRange(0, 20, { visibleStart: 0, visibleEnd: 10, direction: 1, velocity: 4 });
  await tick();
  expect(finishPrefetch).toBeTypeOf('function');
  ensureDirectoryRange(10_000, 10_030, { visibleStart: 10_006, visibleEnd: 10_020, direction: -1, velocity: -4 });
  expect(readDirectoryPage.mock.calls.some((call) => call[1] === 9984)).toBe(true);
  await tick();
  expect(useFileStore.getState().directoryIndex.pages.has(39)).toBe(true);
  finishPrefetch([{ name: 'obsolete' }]);
  await tick();
  expect(useFileStore.getState().directoryIndex.pages.has(1)).toBe(false);
});

it('adapts directional prefetch to observed IO latency and keeps the cache bounded while reversing', async () => {
  await loadWorkspaceFiles('/notes', { navigate: true });
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  let finish;
  readDirectoryPage.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  ensureDirectoryRange(512, 540, { visibleStart: 512, visibleEnd: 530, direction: 1, velocity: 32 });
  now = 400;
  finish([{ name: 'slow page' }]); await tick();
  expect(readDirectoryPage.mock.calls.some((call) => call[1] === 1024)).toBe(true);
  for (let page = 50; page >= 20; page -= 1) {
    ensureDirectoryRange(page * 256, page * 256 + 30, { visibleStart: page * 256 + 6, visibleEnd: page * 256 + 20, direction: -1, velocity: -256 });
    await tick();
    expect(useFileStore.getState().directoryIndex.pages.size).toBeLessThanOrEqual(DIRECTORY_CACHE_PAGES);
  }
  const index = useFileStore.getState().directoryIndex;
  expect(index.pages.has(20)).toBe(true);
  expect(index.pages.has(19)).toBe(true);
});

it('drops staged pages and scheduled publication when the directory is closed', async () => {
  await loadWorkspaceFiles('/notes', { navigate: true });
  ensureDirectoryRange(0, 20);
  await microtasks();
  expect(frames.size).toBe(1);
  useFileStore.getState().clearDirectory();
  expect(frames.size).toBe(0);
  await tick();
  expect(useFileStore.getState().directoryIndex).toBeNull();
});

it('does not publish errors from a viewport superseded before its publication frame', async () => {
  await loadWorkspaceFiles('/notes', { navigate: true });
  readDirectoryPage.mockRejectedValueOnce(new Error('Old viewport error'));
  ensureDirectoryRange(0, 20);
  await microtasks();
  ensureDirectoryRange(10_000, 10_020);
  await tick();
  expect(useFileStore.getState().directoryError).toBe('');
  expect(useFileStore.getState().directoryIndex.pages.has(39)).toBe(true);
});
