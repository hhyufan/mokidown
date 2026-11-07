import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import useEditorStore from '@store/useEditorStore';
import { clearBuffer, getBuffer, setBuffer, registerEditorBufferFlusher } from '@utils/editorBuffer';
import { saveFile } from '@utils/tauriApi';
import { clearDiskBaselines, getDiskBaseline, rememberDiskBaseline } from './localFileGuard';
import { createFileChangeObserver, reconcileFileChange, restoreExternalDisk, saveExistingFile, setLocalFileComposing } from './localFileOperations';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const path = 'C:\\notes\\code.js';
let diskContent;
let observers;
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

beforeEach(() => {
  diskContent = 'base';
  observers = [];
  clearDiskBaselines();
  setLocalFileComposing(false);
  clearBuffer(path);
  useEditorStore.setState({ tabs: [], tabRenderList: [], externalFileConflicts: new Map() });
  useEditorStore.getState().openFile({ path, name: 'code.js', content: diskContent });
  rememberDiskBaseline(path, diskContent);
  invoke.mockImplementation(async (command, args) => {
    if (command === 'read_file_content') return diskContent === null
      ? { success: false } : { success: true, content: diskContent };
    if (command === 'save_file') {
      diskContent = args.content;
      return { success: true };
    }
    throw new Error(`Unexpected command: ${command}`);
  });
});

afterEach(() => {
  observers.forEach((observer) => observer.dispose());
  setLocalFileComposing(false);
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('local file save/watch coordination', () => {
  it.each(['binary', 'too-large', 'invalid-encoding', 'unreadable', 'not-file'])('preserves the buffer and baseline when disk becomes %s, then resumes after recovery', async (kind) => {
    setBuffer(path, 'my unsaved edits');
    invoke.mockRejectedValueOnce({ kind, message: 'blocked disk' });
    expect(await reconcileFileChange(path)).toBe('blocked');
    expect(getBuffer(path)).toBe('my unsaved edits');
    expect(getDiskBaseline(path).content).toBe('base');
    expect(useEditorStore.getState().externalFileConflicts.get(path)).toMatchObject({ kind: 'blocked', blockedReason: kind });
    expect(useEditorStore.getState().externalFileConflicts.get(path)).not.toHaveProperty('diskContent');
    invoke.mockRejectedValueOnce({ kind, message: 'blocked disk' });
    expect(await saveExistingFile(path)).toMatchObject({ success: false, conflict: true });
    expect(invoke.mock.calls.some(([command]) => command === 'save_file')).toBe(false);
    expect(await saveExistingFile(path)).toMatchObject({ success: true });
    expect(diskContent).toBe('my unsaved edits');
    expect(useEditorStore.getState().externalFileConflicts.get(path)).toBeUndefined();
  });

  it('keeps unresolved changes for different tabs independently', async () => {
    const other = 'C:\\notes\\other.js';
    useEditorStore.getState().openFile({ path: other, name: 'other.js', content: 'base' });
    rememberDiskBaseline(other, 'base');
    setBuffer(path, 'first unsaved');
    setBuffer(other, 'other unsaved');
    diskContent = 'disk edit';
    expect(await reconcileFileChange(path)).toBe('conflict');
    expect(await reconcileFileChange(other)).toBe('conflict');
    const conflicts = useEditorStore.getState().externalFileConflicts;
    expect(conflicts.get(path)?.diskContent).toBe('disk edit');
    expect(conflicts.get(other)?.diskContent).toBe('disk edit');
    expect(await restoreExternalDisk(conflicts.get(path))).toBe(true);
    expect(useEditorStore.getState().externalFileConflicts.get(other)).toBe(conflicts.get(other));
    useEditorStore.getState().closeTab(other);
    expect(useEditorStore.getState().externalFileConflicts.size).toBe(0);
  });

  it('does not read files after their editor tab has closed', async () => {
    useEditorStore.setState({ tabs: [], tabRenderList: [] });
    expect(await reconcileFileChange(path)).toBe('superseded');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('flushes a delayed editor before writing and clears dirty state for that exact snapshot', async () => {
    const stop = registerEditorBufferFlusher(() => path, () => {
      setBuffer(path, 'latest editor text');
      useEditorStore.getState().markTabDirty(path);
    });
    try {
      expect(await saveExistingFile(path, 'old buffer', 'UTF-8', path)).toMatchObject({ success: true, savedContent: 'latest editor text' });
      expect(diskContent).toBe('latest editor text');
      expect(useEditorStore.getState().tabRenderList[0].modified).toBe(false);
      expect(useEditorStore.getState().tabs[0].content).toBe(diskContent);
      expect(getDiskBaseline(path).content).toBe(diskContent);
      expect(await reconcileFileChange(path)).toBe('unchanged');
      expect(useEditorStore.getState().externalFileConflicts.get(path)).toBeUndefined();
    } finally { stop(); }
  });
  it('skips a previously scheduled autosave while IME is composing, then saves the committed buffer', async () => {
    setLocalFileComposing(true);
    expect(await saveExistingFile(path, 'unfinished', 'UTF-8', path)).toMatchObject({ superseded: true });
    expect(invoke).not.toHaveBeenCalled();
    setBuffer(path, '中文');
    setLocalFileComposing(false);
    expect(await saveExistingFile(path, 'unfinished', 'UTF-8', path)).toMatchObject({ savedContent: '中文' });
    expect(diskContent).toBe('中文');
  });
  it('waits for our write acknowledgement before checking a watcher event during continued typing', async () => {
    setBuffer(path, 'first word');
    const entered = deferred();
    const acknowledged = deferred();
    invoke.mockImplementation(async (command, args) => {
      if (command === 'read_file_content') return { success: true, content: diskContent };
      diskContent = args.content;
      entered.resolve();
      await acknowledged.promise;
      return { success: true };
    });
    const save = saveExistingFile(path, 'first word', 'UTF-8', path);
    await entered.promise;
    setBuffer(path, 'first word next');
    const watcher = reconcileFileChange(path);
    acknowledged.resolve();
    await save;
    expect(await watcher).toBe('unchanged');
    expect(useEditorStore.getState().externalFileConflicts.get(path)).toBeUndefined();
    expect(getDiskBaseline(path).content).toBe('first word');
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: 'first word', modified: true });
    expect(getBuffer(path)).toBe('first word next');
  });

  it('serializes queued autosaves and uses the current buffer instead of an old debounced snapshot', async () => {
    setBuffer(path, 'newest text');
    const manual = saveExistingFile(path, 'newest text', 'UTF-8', path);
    const staleAutoSave = saveExistingFile(path, 'old text', 'UTF-8', path);
    await manual;
    expect(await staleAutoSave).toMatchObject({ success: true, savedContent: 'newest text' });
    expect(diskContent).toBe('newest text');
    expect(invoke.mock.calls.filter(([cmd]) => cmd === 'save_file')).toHaveLength(1);
    expect(useEditorStore.getState().externalFileConflicts.get(path)).toBeUndefined();
  });

  it('also coordinates writes from save-as/sync using the common native file API', async () => {
    const entered = deferred();
    const acknowledged = deferred();
    invoke.mockImplementation(async (command, args) => {
      if (command === 'read_file_content') return { success: true, content: diskContent };
      diskContent = args.content;
      entered.resolve();
      await acknowledged.promise;
      return { success: true };
    });
    const save = saveFile(path, 'written snapshot', 'UTF-8');
    await entered.promise;
    setBuffer(path, 'subsequent typing');
    const watcher = reconcileFileChange(path);
    acknowledged.resolve();
    await save;
    expect(await watcher).toBe('unchanged');
    expect(useEditorStore.getState().externalFileConflicts.get(path)).toBeUndefined();
  });

  it('rechecks the baseline if the user acknowledges a version while an async read is pending', async () => {
    const entered = deferred();
    const read = deferred();
    diskContent = 'external';
    setBuffer(path, 'my edits');
    invoke.mockImplementationOnce(async () => { entered.resolve(); return read.promise; });
    const watcher = reconcileFileChange(path);
    await entered.promise;
    rememberDiskBaseline(path, 'acknowledged version');
    diskContent = 'acknowledged version';
    read.resolve({ success: true, content: 'external' });
    expect(await watcher).toBe('unchanged');
    expect(getDiskBaseline(path).content).toBe('acknowledged version');
    expect(useEditorStore.getState().externalFileConflicts.get(path)).toBeUndefined();
  });

  it('uses edits made during the disk read instead of reloading over them', async () => {
    diskContent = 'external';
    const entered = deferred();
    const read = deferred();
    invoke.mockImplementationOnce(async () => { entered.resolve(); return read.promise; });
    const watcher = reconcileFileChange(path);
    await entered.promise;
    setBuffer(path, 'IME committed word');
    read.resolve({ success: true, content: diskContent });
    expect(await watcher).toBe('conflict');
    expect(getBuffer(path)).toBe('IME committed word');
  });

  it('blocks writing a genuine external conflict and preserves both versions', async () => {
    diskContent = 'external';
    setBuffer(path, 'my edits');
    expect(await saveExistingFile(path, 'my edits', 'UTF-8', path)).toMatchObject({ conflict: true, success: false });
    expect(diskContent).toBe('external');
    expect(getBuffer(path)).toBe('my edits');
    expect(getDiskBaseline(path).content).toBe('base');
    expect(useEditorStore.getState().externalFileConflicts.get(path)).toMatchObject({ diskContent: 'external' });
    expect(invoke.mock.calls.every(([cmd]) => cmd !== 'save_file')).toBe(true);
  });

  it('reloads a real external-only change and clears an obsolete conflict', async () => {
    diskContent = 'external';
    useEditorStore.getState().setExternalFileConflict({ path, diskContent: 'previous' });
    expect(await reconcileFileChange(path)).toBe('external-only');
    expect(getBuffer(path)).toBe('external');
    expect(useEditorStore.getState().externalFileConflicts.get(path)).toBeUndefined();
  });

  it('checks unpublished editor changes before choosing whether to reload', async () => {
    const stop = registerEditorBufferFlusher(() => path, () => setBuffer(path, 'unpublished edit'));
    try {
      diskContent = 'external';
      expect(await reconcileFileChange(path)).toBe('conflict');
      expect(getBuffer(path)).toBe('unpublished edit');
    } finally {
      stop();
    }
  });

  it('restores the latest readable disk version instead of the reviewed snapshot', async () => {
    diskContent = 'first external version';
    setBuffer(path, 'unsaved edits');
    expect(await reconcileFileChange(path)).toBe('conflict');
    const externalFileConflict = useEditorStore.getState().externalFileConflicts.get(path);
    diskContent = 'latest external version';
    expect(await restoreExternalDisk(externalFileConflict)).toBe(true);
    expect(getBuffer(path)).toBe(diskContent);
    expect(getDiskBaseline(path).content).toBe(diskContent);
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: diskContent, modified: false });
    expect(useEditorStore.getState().externalFileConflicts.get(path)).toBeUndefined();
  });

  it('reads current disk content for delayed events from earlier saves', async () => {
    setBuffer(path, 'first');
    await saveExistingFile(path, 'first', 'UTF-8', path);
    setBuffer(path, 'second');
    await saveExistingFile(path, 'second', 'UTF-8', path);
    setBuffer(path, 'third, still editing');
    vi.useFakeTimers();
    const observer = createFileChangeObserver({ delay: 10 });
    observers.push(observer);
    observer({ path, kind: 'modified', modifiedAt: 1, size: 5 });
    await vi.advanceTimersByTimeAsync(10);
    expect(getDiskBaseline(path).content).toBe('second');
    expect(getBuffer(path)).toBe('third, still editing');
    expect(useEditorStore.getState().externalFileConflicts.get(path)).toBeUndefined();
  });

  it('does not acknowledge a failed write, and releases the queue for a retry', async () => {
    setBuffer(path, 'my edits');
    invoke.mockImplementationOnce(async () => ({ success: true, content: diskContent }));
    invoke.mockRejectedValueOnce(new Error('write failed'));
    await expect(saveExistingFile(path, 'my edits', 'UTF-8', path)).rejects.toThrow('write failed');
    expect(getDiskBaseline(path).content).toBe('base');
    expect(diskContent).toBe('base');
    expect(await saveExistingFile(path, 'my edits', 'UTF-8', path)).toMatchObject({ success: true });
    expect(diskContent).toBe('my edits');
  });

  it('does not report the temporary missing-file gap in an atomic replacement', async () => {
    vi.useFakeTimers();
    const observer = createFileChangeObserver({ delay: 10 });
    observers.push(observer);
    diskContent = null;
    observer({ path, kind: 'removed' });
    await vi.advanceTimersByTimeAsync(10);
    expect(useEditorStore.getState().externalFileConflicts.get(path)).toBeUndefined();
    diskContent = 'base';
    observer({ path, kind: 'renamed' });
    await vi.advanceTimersByTimeAsync(30);
    expect(useEditorStore.getState().externalFileConflicts.get(path)).toBeUndefined();
  });

  it('reports a deletion only after a second disk check confirms it', async () => {
    vi.useFakeTimers();
    const observer = createFileChangeObserver({ delay: 10 });
    observers.push(observer);
    diskContent = null;
    observer({ path, kind: 'removed' });
    await vi.advanceTimersByTimeAsync(10);
    expect(useEditorStore.getState().externalFileConflicts.get(path)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(10);
    expect(useEditorStore.getState().externalFileConflicts.get(path)).toMatchObject({ kind: 'removed', path });
  });

  it('does not deliver a pending conflict after the observer is disposed', async () => {
    vi.useFakeTimers();
    const observer = createFileChangeObserver({ delay: 10 });
    diskContent = 'external';
    setBuffer(path, 'my edits');
    observer({ path });
    observer.dispose();
    await vi.advanceTimersByTimeAsync(30);
    expect(useEditorStore.getState().externalFileConflicts.get(path)).toBeUndefined();
  });

  it('defers external reloads during IME composition and protects the committed word', async () => {
    vi.useFakeTimers();
    let composing = true;
    const observer = createFileChangeObserver({ delay: 10, isComposing: () => composing });
    observers.push(observer);
    diskContent = 'external';
    observer({ path });
    await vi.advanceTimersByTimeAsync(30);
    expect(getBuffer(path)).toBe('base');
    expect(invoke).not.toHaveBeenCalled();
    setBuffer(path, '中文');
    composing = false;
    await vi.advanceTimersByTimeAsync(10);
    expect(getBuffer(path)).toBe('中文');
    expect(useEditorStore.getState().externalFileConflicts.get(path)).toMatchObject({ diskContent: 'external' });
  });
});
