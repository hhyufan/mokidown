import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import FileTree from './FileTree';
import useFileStore from '@store/useFileStore';
import usePluginContributions from '@store/usePluginContributions';
import { deleteFile, readDirectoryPage } from '@utils/tauriApi';
import { confirm } from '@tauri-apps/plugin-dialog';

globalThis.React = React;
const mock = vi.hoisted(() => ({ loadDirectory: vi.fn(async () => {}), openFileFromPath: vi.fn(), notify: vi.fn() }));
vi.mock('@hooks/useFileManager', () => ({ useFileManager: () => ({ loadDirectory: mock.loadDirectory, openFileFromPath: mock.openFileFromPath }) }));
vi.mock('@components/ui/FileTypeIcon', () => ({ default: () => <span data-rich-icon="true" /> }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: vi.fn() }));
vi.mock('@utils/tauriApi', () => ({ deleteFile: vi.fn(), readDirectoryPage: vi.fn(), closeDirectoryIndex: vi.fn(async () => {}), isSafUri: () => false, safDisplayName: (path) => path }));
vi.mock('@store/useNotificationStore', () => ({ default: { getState: () => ({ notify: mock.notify }) } }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
  // @/i18n 初始化时要用它。缺了它，只要有依赖链把 @/i18n 拉进来
  // （测试 → useEditorStore → untitledFileName → @/i18n）就会整体报错。
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('@/i18n', () => ({ default: { t: (key) => key } }));
beforeEach(() => {
  vi.clearAllMocks();
  usePluginContributions.setState({ fileBadges: [] });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  useFileStore.setState({ currentDir: '/notes', directoryIndex: null, directoryLoading: false, directoryError: '', files: [{ path: '/notes/test.md', name: 'test.md', is_dir: false }], dirHistory: ['/notes'], historyIndex: 0 });
  deleteFile.mockResolvedValue({ success: true });
});
afterEach(() => { cleanup(); useFileStore.getState().clearDirectory(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function openConfirmation() {
  const view = render(<FileTree />);
  fireEvent.click(view.container.querySelector('.file-tree__item-del'));
  return view;
}
it('opens an in-app dialog and cancelling never invokes deletion or native confirmation', async () => {
  openConfirmation();
  expect(screen.getByRole('dialog')).toHaveTextContent('test.md');
  expect(deleteFile).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'sidebar.explorer.cancelDelete' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(deleteFile).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
});
it('waits for frontend confirmation and submits exactly once while deletion is pending', async () => {
  let complete;
  deleteFile.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  openConfirmation();
  const button = screen.getByRole('button', { name: 'sidebar.explorer.confirmDelete' });
  fireEvent.click(button); fireEvent.click(button);
  expect(deleteFile).toHaveBeenCalledExactlyOnceWith('/notes/test.md');
  expect(screen.getByRole('button', { name: 'sidebar.explorer.cancelDelete' })).toBeDisabled();
  await act(async () => complete({ success: true }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(mock.loadDirectory).toHaveBeenCalledWith('/notes'); expect(confirm).not.toHaveBeenCalled();
});
it('retains the dialog for retry when deletion fails', async () => {
  deleteFile.mockResolvedValueOnce({ success: false, error: 'Access denied' });
  openConfirmation();
  fireEvent.click(screen.getByRole('button', { name: 'sidebar.explorer.confirmDelete' }));
  await waitFor(() => expect(mock.notify).toHaveBeenCalledWith('error', 'notification.error', expect.stringContaining('Access denied')));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'sidebar.explorer.cancelDelete' })).not.toBeDisabled();
});

it('reacts to plugin badge updates and removes them when the plugin unloads', async () => {
  const view = render(<FileTree />);
  const badge = { id: 'document-state', paths: ['test.md'], svg: '<svg />', title: 'Completed' };
  act(() => usePluginContributions.getState().addFileBadge('example.plugin', badge));
  fireEvent.mouseOver(view.container.querySelector('.file-tree__item-badge'));
  await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Completed'));
  act(() => usePluginContributions.getState().addFileBadge('example.plugin', { ...badge, title: 'Failed' }));
  await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Failed'));
  act(() => usePluginContributions.getState().clearPlugin('example.plugin'));
  expect(view.container.querySelector('.file-tree__item-badge')).toBeNull();
});

it('opens the final file in a ten-million-entry paged directory without materializing the listing', async () => {
  useFileStore.setState({ files: [], directoryIndex: { id: 'large', total: 10_000_000, pageSize: 256, path: '/notes', pages: new Map() } });
  readDirectoryPage.mockImplementation(async (_id, offset, limit) => Array.from({ length: Math.min(limit, 10_000_000 - offset) }, (_, index) => ({
    name: `note${offset + index}.md`, path: `/notes/note${offset + index}.md`, is_dir: false,
  })));
  const view = render(<FileTree />);
  await screen.findByText('note0.md');
  fireEvent.keyDown(screen.getByRole('list'), { key: 'End' });
  await screen.findByText('note9999999.md');
  expect(view.container.querySelectorAll('.file-tree__item').length).toBeLessThan(30);
  expect(useFileStore.getState().files).toHaveLength(0);
  // The fast-scroll details handoff may recycle the name node during findBy's
  // async act flush. Click the current row rather than retaining that old node.
  fireEvent.click(view.container.querySelector('[data-path="/notes/note9999999.md"]'));
  expect(mock.openFileFromPath).toHaveBeenCalledWith('/notes/note9999999.md', 'note9999999.md');
});

it('keeps filenames and actions during fast scrolling and restores rich icons and plugin badges after idle', async () => {
  vi.useFakeTimers();
  let frameId = 0;
  const frames = new Map();
  vi.stubGlobal('requestAnimationFrame', (callback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id) => frames.delete(id));
  const lastPage = Array.from({ length: 128 }, (_, index) => ({ name: `note${9_999_872 + index}.md`, path: `/notes/note${9_999_872 + index}.md`, is_dir: false }));
  useFileStore.setState({ files: [], directoryIndex: {
    id: 'layered', total: 10_000_000, pageSize: 256, path: '/notes',
    pages: new Map([[0, [{ name: 'note0.md', path: '/notes/note0.md', is_dir: false }]], [39062, lastPage]]),
  } });
  readDirectoryPage.mockResolvedValue([{ name: 'prefetched.md' }]);
  usePluginContributions.getState().addFileBadge('example.plugin', { id: 'status', paths: ['note9999999.md'], svg: '<svg />', title: 'Completed' });
  const view = render(<FileTree />);
  fireEvent.keyDown(screen.getByRole('list'), { key: 'End' });
  await act(async () => {
    const callbacks = [...frames.values()]; frames.clear();
    callbacks.forEach((callback) => callback(performance.now() + 16));
  });
  const last = screen.getByText('note9999999.md');
  const row = last.closest('[role=listitem]');
  expect(row).toHaveAttribute('data-details', 'deferred');
  expect(row.querySelector('[data-rich-icon]')).toBeNull();
  expect(row.querySelector('.file-tree__item-badge')).toBeNull();
  fireEvent.click(last);
  expect(mock.openFileFromPath).toHaveBeenCalledWith('/notes/note9999999.md', 'note9999999.md');
  act(() => vi.advanceTimersByTime(120));
  expect(row).toHaveAttribute('data-details', 'ready');
  expect(row.querySelector('[data-rich-icon]')).toBeInTheDocument();
  expect(row.querySelector('.file-tree__item-badge')).toBeInTheDocument();
  expect(view.container.querySelectorAll('.file-tree__item').length).toBeLessThan(30);
});
