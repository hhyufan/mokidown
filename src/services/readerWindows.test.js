import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import useEditorStore from '@store/useEditorStore';
import { setBuffer } from '@utils/editorBuffer';
import { invoke } from '@utils/tauriInvoke';
import { beginReaderTabDetachWatch, beginReaderFileDetachWatch, buildDragPreview, cancelReaderTabDetachWatch, detachMarkdownTab, receiveReaderDocument } from './readerWindows';

vi.mock('@utils/tauriInvoke', () => ({ invoke: vi.fn() }));
vi.mock('@utils/tauriApi', () => ({ historyCapture: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./editorSession', () => ({ restoreEditorSession: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  useEditorStore.setState({ tabs: [], tabRenderList: [], activeTabId: null });
  window.__TAURI_INTERNALS__ = {};
  invoke.mockReset().mockResolvedValue('reader-1');
});
afterEach(() => { delete window.__TAURI_INTERNALS__; });

const open = () => useEditorStore.getState().openFile({ path: '/a.md', name: 'a.md', content: 'disk' });

it('transfers a saved Markdown document and removes its source tab only after creation', async () => {
  open();
  await detachMarkdownTab('/a.md', { screenX: -500, screenY: 200 });
  expect(invoke).toHaveBeenCalledWith('open_reader_window', {
    document: expect.objectContaining({ path: '/a.md', content: 'disk', modified: false }), x: -500, y: 200,
  });
  expect(useEditorStore.getState().tabs).toHaveLength(0);
});

it('starts and cancels the native outside-window drag watcher without moving the source tab', async () => {
  open();
  await beginReaderTabDetachWatch('/a.md');
  expect(invoke).toHaveBeenCalledWith('begin_reader_tab_detach_watch', {
    document: expect.objectContaining({ path: '/a.md', content: 'disk', modified: false }),
  });
  expect(useEditorStore.getState().tabs).toHaveLength(1);
  await cancelReaderTabDetachWatch();
  expect(invoke).toHaveBeenLastCalledWith('cancel_reader_tab_detach_watch');
});

it('preserves the ghost dimensions, typography and grab point for a continuous native handoff', () => {
  const row = document.createElement('div');
  row.dataset.readerName = 'notes.md';
  row.innerHTML = '<span class="file-tree__item-icon"><svg viewBox="0 0 24 24"><path d="M0 0h1" /></svg></span>';
  Object.assign(row.style, { width: '184px', height: '32px', fontSize: '13px', gap: '8px' });
  document.body.append(row);
  const preview = buildDragPreview(row, undefined, row, { offsetX: 47, offsetY: 12, token: 'drag-1' });
  expect(preview).toMatchObject({
    name: 'notes.md', width: 184, height: 32, offsetX: 47, offsetY: 12, token: 'drag-1',
    appearance: { fontSize: '13px', gap: '8px' },
  });
  expect(preview.icon).toMatch(/^data:image\/svg\+xml,/);
  row.remove();
});

it('uses an existing dirty buffer for sidebar drags and keeps its editable source', async () => {
  open();
  setBuffer('/a.md', 'unsaved sidebar text');
  useEditorStore.getState().markTabDirty('/a.md');
  const preview = { token: 'file-drag', name: 'a.md' };
  await beginReaderFileDetachWatch('/a.md', 'a.md', preview);
  expect(invoke).toHaveBeenLastCalledWith('begin_reader_tab_detach_watch', {
    document: expect.objectContaining({ content: 'unsaved sidebar text', modified: true, keepSource: true }), preview,
  });
  expect(useEditorStore.getState().tabs).toHaveLength(1);
});

it('passes the latest buffer and retains dirty documents in the editor', async () => {
  open();
  setBuffer('/a.md', 'unsaved text');
  useEditorStore.getState().markTabDirty('/a.md');
  await detachMarkdownTab('/a.md');
  expect(invoke.mock.calls[0][1].document).toMatchObject({ content: 'unsaved text', modified: true });
  expect(useEditorStore.getState().tabs).toHaveLength(1);
});

it('retains a source tab on window creation failure or edits during creation', async () => {
  open();
  invoke.mockRejectedValueOnce(new Error('creation failed'));
  await expect(detachMarkdownTab('/a.md')).rejects.toThrow('creation failed');
  expect(useEditorStore.getState().tabs).toHaveLength(1);
  invoke.mockImplementationOnce(async () => {
    setBuffer('/a.md', 'edited during opening');
    return 'reader-2';
  });
  await detachMarkdownTab('/a.md');
  expect(useEditorStore.getState().tabs).toHaveLength(1);
});

it('retains untitled drafts and ignores non-Markdown tabs and browser mode', async () => {
  useEditorStore.getState().createUntitledTab();
  const id = useEditorStore.getState().activeTabId;
  await detachMarkdownTab(id);
  expect(useEditorStore.getState().tabs).toHaveLength(1);
  useEditorStore.getState().openFile({ path: '/a.rs', name: 'a.rs', content: 'fn main() {}' });
  invoke.mockClear();
  expect(await detachMarkdownTab('/a.rs')).toBe(false);
  delete window.__TAURI_INTERNALS__;
  expect(await detachMarkdownTab(id)).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
});

it('returns to an existing editor tab without overwriting newer text', async () => {
  open();
  setBuffer('/a.md', 'newer');
  const openFile = vi.fn();
  await receiveReaderDocument({ id: '/a.md', path: '/a.md', content: 'old', modified: true }, openFile);
  expect(useEditorStore.getState().getTabContent('/a.md')).toBe('newer');
  expect(openFile).not.toHaveBeenCalled();
});

it('rereads saved files on return and restores drafts without writing to disk', async () => {
  const openFile = vi.fn();
  await receiveReaderDocument({ id: '/a.md', path: '/a.md', name: 'a.md', modified: false }, openFile);
  expect(openFile).toHaveBeenCalledWith('/a.md', 'a.md');
  await receiveReaderDocument({ id: 'draft', path: '', name: 'draft.md', content: 'draft text', modified: true }, openFile);
  expect(useEditorStore.getState().getActiveTab()).toMatchObject({ content: 'draft text', modified: true, path: '' });
});
