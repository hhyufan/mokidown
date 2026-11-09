import * as React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReaderFooter from './ReaderFooter';
import { getDirectoryContents } from '@utils/tauriApi';
import { useRuntimeLogStore } from '@/services/runtimeLogs';
import useUpdateStore from '@store/useUpdateStore';

globalThis.React = React;
vi.mock('@utils/tauriApi', () => ({
  getDirectoryContents: vi.fn(), isSafUri: () => false, safDisplayName: (path) => path,
}));
vi.mock('@components/ui/FileTypeIcon', () => ({ default: () => null }));
vi.mock('@hooks/useTasks', () => ({ default: () => ({ active: null }) }));
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal(), useTranslation: () => ({ t: (key) => key }),
}));
afterEach(() => {
  cleanup(); vi.clearAllMocks();
  useRuntimeLogStore.setState({ entries: [], open: false });
  useUpdateStore.setState({ open: false });
});
const info = { name: 'a.md', path: 'C:\\docs\\a.md', encoding: 'UTF-16LE', lineEnding: 'CRLF' };
const view = (props = {}) => render(<ReaderFooter document={info} content={'ab\r\ncd'}
  position={{ lineNumber: 2, column: 3 }} onOpenFile={vi.fn()} {...props} />);

it('opens the task list rather than opening the error log directly', () => {
  useRuntimeLogStore.setState({ entries: [{ id: 'error-1', message: 'failure' }], open: false });
  view();
  fireEvent.click(screen.getByRole('button', { name: 'tasks.title' }));
  expect(useUpdateStore.getState().open).toBe(true);
  expect(useRuntimeLogStore.getState().open).toBe(false);
});

it('shows document metadata and cursor status without a tab store', () => {
  view();
  expect(screen.getByText('footer.line 2, footer.column 3')).toBeInTheDocument();
  expect(screen.getByText('6 footer.chars')).toBeInTheDocument();
  expect(screen.getByText('UTF-16LE')).toBeInTheDocument();
  expect(screen.getByText('CRLF')).toBeInTheDocument();
});

it('browses folders and opens non-Markdown files through the single-document callback', async () => {
  const file = { name: 'config.json', path: 'C:\\docs\\nested\\config.json', is_dir: false };
  getDirectoryContents.mockResolvedValueOnce([{ name: 'nested', path: 'C:\\docs\\nested', is_dir: true }])
    .mockResolvedValueOnce([file]);
  const open = vi.fn().mockResolvedValue(undefined);
  view({ onOpenFile: open });
  fireEvent.click(screen.getByRole('button', { name: 'C:\\docs' }));
  expect(getDirectoryContents).toHaveBeenCalledWith('C:\\docs');
  fireEvent.click(await screen.findByRole('menuitem', { name: 'nested' }));
  expect(getDirectoryContents).toHaveBeenLastCalledWith('C:\\docs\\nested');
  fireEvent.click(await screen.findByRole('menuitem', { name: 'config.json' }));
  expect(open).toHaveBeenCalledWith(file);
  expect(screen.queryByRole('menu')).toBeNull();
});

it('ignores late folder results when a different breadcrumb was clicked', async () => {
  let finishOld;
  getDirectoryContents.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
    .mockResolvedValueOnce([{ name: 'latest.md', path: 'C:\\latest.md' }]);
  view();
  fireEvent.click(screen.getByRole('button', { name: 'C:\\docs' }));
  fireEvent.click(screen.getByRole('button', { name: 'C:\\' }));
  await screen.findByRole('menuitem', { name: 'latest.md' });
  finishOld([{ name: 'stale.md', path: 'C:\\docs\\stale.md' }]);
  await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'stale.md' })).toBeNull());
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
});

it('preserves a drive root when Windows paths use forward slashes', async () => {
  getDirectoryContents.mockResolvedValue([]);
  view({ document: { ...info, path: 'C:/docs/a.md' } });
  fireEvent.click(screen.getByRole('button', { name: 'C:/' }));
  await waitFor(() => expect(getDirectoryContents).toHaveBeenCalledWith('C:/'));
});

it('surfaces directory errors and infers the line ending for snapshots', async () => {
  getDirectoryContents.mockRejectedValue(new Error('Permission denied'));
  view({ document: { name: 'a.md', path: info.path } });
  expect(screen.getByText('CRLF')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'C:\\docs' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Permission denied');
});
