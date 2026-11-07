import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import useFileStore from '@store/useFileStore';
import ExplorerNavigation from './ExplorerNavigation';

globalThis.React = React;
const mock = vi.hoisted(() => ({ loadDirectory: vi.fn(), loadFilesOnly: vi.fn(), openInExplorer: vi.fn() }));
vi.mock('@hooks/useFileManager', () => ({ useFileManager: () => mock }));
vi.mock('@/i18n', () => ({ default: { t: (key) => key } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));
const search = { results: [], index: 0, open: false, query: '', toggle: vi.fn(), move: vi.fn(), setQuery: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); useFileStore.setState({ currentDir: 'C:\\notes', dirHistory: ['C:\\', 'C:\\notes', 'C:\\next'], historyIndex: 1 }); });
afterEach(cleanup);

it('retains working back and forward controls in file mode only', () => {
  const { rerender } = render(<ExplorerNavigation search={search} />);
  fireEvent.click(screen.getByRole('button', { name: 'sidebar.explorer.back' }));
  expect(mock.loadFilesOnly).toHaveBeenCalledWith('C:\\');
  expect(useFileStore.getState().historyIndex).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'sidebar.explorer.forward' }));
  expect(mock.loadFilesOnly).toHaveBeenLastCalledWith('C:\\notes');
  rerender(<ExplorerNavigation search={search} project />);
  expect(screen.queryByRole('button', { name: 'sidebar.explorer.back' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'sidebar.explorer.forward' })).toBeNull();
  for (const key of ['up', 'refresh', 'openInExplorer', 'closeFolder']) expect(screen.getByRole('button', { name: `sidebar.explorer.${key}` })).toBeInTheDocument();
});

it.each([false, true])('disables Up at the filesystem root (project=%s)', (project) => {
  useFileStore.setState({ currentDir: 'C:\\' });
  render(<ExplorerNavigation search={search} project={project} />);
  const up = screen.getByRole('button', { name: 'sidebar.explorer.up' });
  expect(up).toBeDisabled(); fireEvent.click(up);
  expect(mock.loadDirectory).not.toHaveBeenCalled();
});

it('keeps the filename drawer mounted and makes it inert while collapsed', () => {
  const { container, rerender } = render(<ExplorerNavigation search={search} project />);
  expect(container.querySelector('.explorer-search')).toHaveAttribute('inert');
  rerender(<ExplorerNavigation search={{ ...search, open: true }} project />);
  const input = screen.getByRole('textbox', { name: 'sidebar.project.search' });
  expect(input).toHaveFocus();
  expect(container.querySelector('.explorer-search')).not.toHaveAttribute('inert');
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  expect(search.move).toHaveBeenCalledWith(-1);
});

it('moves between filename matches with unmodified arrow keys', () => {
  render(<ExplorerNavigation search={{ ...search, open: true, results: [{}] }} project />);
  const input = screen.getByRole('textbox', { name: 'sidebar.project.search' });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  fireEvent.keyDown(input, { key: 'ArrowDown', altKey: true });
  expect(search.move.mock.calls).toEqual([[1], [-1]]);
});

it('places Open selected immediately after Up in project mode and guards unavailable selections', () => {
  const open = vi.fn();
  const { rerender } = render(<ExplorerNavigation search={search} project onOpenSelected={open} canOpenSelected={false} />);
  expect(screen.getByRole('button', { name: 'sidebar.project.openSelected' })).toBeDisabled();
  rerender(<ExplorerNavigation search={search} project onOpenSelected={open} canOpenSelected />);
  const up = screen.getByRole('button', { name: 'sidebar.explorer.up' });
  const down = screen.getByRole('button', { name: 'sidebar.project.openSelected' });
  expect(up.closest('button').nextElementSibling).toBe(down);
  fireEvent.click(down); expect(open).toHaveBeenCalledOnce();
});

it('shows filename search only in project mode, right after Up/Open selected', () => {
  const { rerender } = render(<ExplorerNavigation search={search} />);
  expect(screen.queryByRole('button', { name: 'sidebar.project.search' })).toBeNull();
  rerender(<ExplorerNavigation search={search} project onOpenSelected={() => {}} canOpenSelected />);
  const up = screen.getByRole('button', { name: 'sidebar.explorer.up' });
  const down = screen.getByRole('button', { name: 'sidebar.project.openSelected' });
  const toggle = screen.getByRole('button', { name: 'sidebar.project.search' });
  expect(up.nextElementSibling).toBe(down);
  expect(down.nextElementSibling).toBe(toggle);
});

it('greys out Collapse all once the root folder is collapsed', () => {
  const { rerender } = render(<ExplorerNavigation search={search} project onExpandSelected={() => {}} onCollapseAll={() => {}} canCollapseAll />);
  expect(screen.getByRole('button', { name: 'sidebar.project.collapseAll' })).toBeEnabled();
  rerender(<ExplorerNavigation search={search} project onExpandSelected={() => {}} onCollapseAll={() => {}} canCollapseAll={false} />);
  expect(screen.getByRole('button', { name: 'sidebar.project.collapseAll' })).toBeDisabled();
});
