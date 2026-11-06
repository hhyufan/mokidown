import useFileStore from '@store/useFileStore';
import { closeDirectoryIndex, getDirectoryContents, isSafUri, openDirectoryIndex, readDirectoryPage } from '@utils/tauriApi';
import { sortDirectoryContents } from '@utils/directoryContents';
import { FILE_ROW_HEIGHT } from '@utils/virtualFileWindow';

export const DIRECTORY_CACHE_PAGES = 16;
let sequence = 0;
let generation = 0;
let activeRequest = null;
let pageReader = null;

function disposePageReader() {
  if (pageReader?.frame != null) cancelAnimationFrame(pageReader.frame);
  if (pageReader) pageReader.disposed = true;
  pageReader = null;
}

export function usesDirectoryIndex(path) {
  return Boolean(window.__TAURI_INTERNALS__) && !isSafUri(path) && !String(path).startsWith('web:');
}

function release(id) {
  if (id) void closeDirectoryIndex(id).catch(() => {});
}

// A single current request owns the native snapshot. Closing or navigating also
// cancels a build that has not returned yet, so stale IO cannot repopulate state.
useFileStore.subscribe((state, previous) => {
  if (state.explorerMode !== previous.explorerMode) disposePageReader();
  if (state.directoryIndex?.id !== previous.directoryIndex?.id) disposePageReader();
  if (state.currentDir !== previous.currentDir) sequence += 1;
  if (activeRequest && state.currentDir !== activeRequest.path) {
    release(activeRequest.id);
    activeRequest = null;
  }
  if (previous.directoryIndex && previous.directoryIndex.id !== state.directoryIndex?.id) {
    release(previous.directoryIndex.id);
  }
  if (activeRequest && state.currentDir === activeRequest.path &&
      (state.sortBy !== previous.sortBy || state.sortOrder !== previous.sortOrder)) {
    void loadWorkspaceFiles(state.currentDir).catch(() => {});
  }
});

export async function loadWorkspaceFiles(path, { navigate = false, isCurrent = () => true } = {}) {
  const native = usesDirectoryIndex(path);
  const state = useFileStore.getState();
  if (native && navigate && state.currentDir !== path) state.setCurrentDir(path);
  const request = ++sequence;
  release(activeRequest?.id);
  activeRequest = null;
  if (!native) {
    const contents = await getDirectoryContents(path);
    if (request !== sequence || !isCurrent()) return;
    const state = useFileStore.getState();
    state.setFiles(sortDirectoryContents(contents, state));
    if (navigate && state.currentDir !== path) state.setCurrentDir(path);
    return;
  }

  generation = Math.max(generation + 1, Date.now() * 1000);
  const id = `directory-${generation}`;
  activeRequest = { id, path };
  const { sortBy, sortOrder } = state;
  useFileStore.setState({ files: [], directoryIndex: null, directoryLoading: true, directoryError: '' });
  try {
    const result = await openDirectoryIndex(id, path, sortBy, sortOrder);
    if (request !== sequence || useFileStore.getState().currentDir !== path || !isCurrent()) {
      release(id);
      return;
    }
    useFileStore.setState({ directoryIndex: { ...result, path, sortBy, sortOrder, pages: new Map() }, directoryLoading: false });
  } catch (error) {
    if (request !== sequence || useFileStore.getState().currentDir !== path || !isCurrent()) return;
    useFileStore.setState({ directoryLoading: false, directoryError: String(error) });
    release(id);
    throw error;
  }
}

export function getIndexedFile(index, position) {
  return index?.pages.get(Math.floor(position / index.pageSize))?.[position % index.pageSize];
}

// This plan is rebuilt from the *latest* viewport, never an accumulated queue.
// Visible pages come first, then render buffers, then directional prefetch. IO
// latency and logical velocity determine the bounded lookahead distance.
function pagePlan(index, request, latency) {
  const result = [];
  const seen = new Set();
  const lastPage = Math.ceil(index.total / index.pageSize) - 1;
  const add = (page, visible = false) => {
    if (page >= 0 && page <= lastPage && !seen.has(page) && result.length < DIRECTORY_CACHE_PAGES) {
      seen.add(page);
      result.push({ page, visible });
    }
  };
  const firstVisible = Math.floor(request.visibleStart / index.pageSize);
  const lastVisible = Math.floor(Math.max(request.visibleStart, request.visibleEnd - 1) / index.pageSize);
  for (let page = firstVisible; page <= Math.min(lastVisible, firstVisible + DIRECTORY_CACHE_PAGES - 1); page += 1) add(page, true);
  const first = Math.floor(request.start / index.pageSize);
  const last = Math.floor(Math.max(request.start, request.end - 1) / index.pageSize);
  for (let page = first; page <= Math.min(last, first + DIRECTORY_CACHE_PAGES - 1); page += 1) add(page);
  if (request.prefetch) {
    const ahead = Math.min(6, Math.max(1, Math.ceil(Math.abs(request.velocity) * Math.max(120, latency * 2) / FILE_ROW_HEIGHT / index.pageSize)));
    const direction = request.direction < 0 ? -1 : 1;
    for (let step = 1; step <= ahead; step += 1) add(direction > 0 ? last + step : first - step);
    add(direction > 0 ? first - 1 : last + 1);
  }
  return result;
}

function currentPlan(reader) {
  const index = useFileStore.getState().directoryIndex;
  return !reader.disposed && index?.id === reader.id ? pagePlan(index, reader.request, reader.latency) : [];
}

function publishPages(reader) {
  if (reader.frame != null) return;
  reader.frame = requestAnimationFrame(() => {
    reader.frame = null;
    const index = useFileStore.getState().directoryIndex;
    if (reader.disposed || index?.id !== reader.id) return;
    const plan = currentPlan(reader);
    const wanted = new Set(plan.map(({ page }) => page));
    const pages = new Map(index.pages);
    let changed = false;
    for (const [page, rows] of reader.ready) {
      if (wanted.has(page)) { pages.delete(page); pages.set(page, rows); changed = true; }
    }
    reader.ready.clear();
    // Evict pages outside the new viewport/forecast before useful older pages.
    for (const page of pages.keys()) {
      if (pages.size <= DIRECTORY_CACHE_PAGES) break;
      if (!wanted.has(page)) pages.delete(page);
    }
    while (pages.size > DIRECTORY_CACHE_PAGES) pages.delete(pages.keys().next().value);
    const error = plan.filter((item) => item.visible).map((item) => reader.errors.get(item.page)).find(Boolean);
    reader.errors.clear();
    if (changed || error) {
      useFileStore.setState({ ...(changed ? { directoryIndex: { ...index, pages } } : {}), directoryError: error || '' });
    }
  });
}

function pumpPages(reader) {
  const index = useFileStore.getState().directoryIndex;
  if (reader.disposed || index?.id !== reader.id) return;
  for (const item of currentPlan(reader)) {
    if (reader.inFlight.size >= 2) break;
    const { page, visible } = item;
    if (index.pages.has(page) || reader.ready.has(page) || reader.inFlight.has(page) || reader.failed.has(page)) continue;
    // Leave one slot available for an urgent viewport jump. A speculative read
    // must never occupy both slots and delay newly visible rows behind it.
    if (!visible && [...reader.inFlight.values()].some((request) => !request.visible)) continue;
    const started = performance.now();
    reader.inFlight.set(page, { visible });
    void (async () => {
      try {
        const rows = await readDirectoryPage(reader.id, page * index.pageSize, index.pageSize);
        if (reader.disposed || useFileStore.getState().directoryIndex?.id !== reader.id) return;
        if (!Array.isArray(rows) || !rows.length) throw new Error('Could not read directory page');
        reader.latency = reader.latency * 0.75 + (performance.now() - started) * 0.25;
        if (currentPlan(reader).some((item) => item.page === page)) {
          reader.ready.set(page, rows);
          publishPages(reader);
        }
      } catch (error) {
        reader.failed.add(page);
        if (currentPlan(reader).some((item) => item.page === page && item.visible)) {
          reader.errors.set(page, String(error));
          publishPages(reader);
        }
      } finally {
        reader.inFlight.delete(page);
        pumpPages(reader);
      }
    })();
  }
}

export function ensureDirectoryRange(start, end, motion) {
  const index = useFileStore.getState().directoryIndex;
  if (!index || end <= start) return;
  if (!pageReader || pageReader.id !== index.id) {
    disposePageReader();
    pageReader = { id: index.id, inFlight: new Map(), ready: new Map(), failed: new Set(), errors: new Map(), frame: null, latency: 40, disposed: false };
  }
  pageReader.request = {
    start, end, visibleStart: motion?.visibleStart ?? start, visibleEnd: motion?.visibleEnd ?? end,
    direction: motion?.direction || 0, velocity: motion?.velocity || 0, prefetch: Boolean(motion),
  };
  pageReader.failed.clear();
  // Drop staged results that became obsolete before their publication frame.
  const wanted = new Set(currentPlan(pageReader).map(({ page }) => page));
  for (const page of pageReader.ready.keys()) if (!wanted.has(page)) pageReader.ready.delete(page);
  pumpPages(pageReader);
}
