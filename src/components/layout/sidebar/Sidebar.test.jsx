import * as React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import useEditorStore from '@store/useEditorStore';
import useFileStore from '@store/useFileStore';



import i18n from '@/i18n';
import Sidebar from './Sidebar';

globalThis.React = React;
const openFile = vi.hoisted(() => vi.fn());
vi.mock('@hooks/useFileManager', () => ({ useFileManager: () => ({ openFileFromPath: openFile }) }));
vi.mock('./explorer/FileTree', () => ({ default: () => null }));
vi.mock('./outline/OutlineView', () => ({ default: () => null }));

vi.mock('@components/ui/FileTypeIcon', () => ({ default: () => null }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('keeps recent-file identity and clicks correct when the list is reordered without key warnings', () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  i18n.changeLanguage('zh');
  
  useEditorStore.setState({ sidebarView: 'recent', sidebarVisible: true });
  
  
  const first = { name: 'first.py', path: 'C:/first.py', ext: 'py' };
  const second = { name: 'second.kt', path: 'C:/second.kt', ext: 'kt' };
  useFileStore.setState({ recentFiles: [first, second] });
  render(<React.StrictMode><Sidebar /></React.StrictMode>);
  act(() => useFileStore.setState({ recentFiles: [second, first] }));
  fireEvent.click(screen.getByText('second.kt'));
  expect(openFile).toHaveBeenCalledWith('C:/second.kt', 'second.kt');
  expect(errors.mock.calls.flat().join(' ')).not.toMatch(/unique.*key|same key|findDOMNode|Maximum update depth/);
});

it('shows outline only for Markdown and falls back to files when it becomes unavailable', () => {
  i18n.changeLanguage('en');
  const markdown = { id: 'md', name: 'note.md', path: '/note.md', content: '# Title' };
  const code = { id: 'code', name: 'main.java', path: '/main.java', content: 'class Main {}' };
  useEditorStore.setState({ tabs: [markdown, code], activeTabId: markdown.id, sidebarView: 'outline', sidebarVisible: true });
  render(<Sidebar />);
  expect(screen.getByRole('tab', { name: 'Outline' })).toHaveAttribute('aria-selected', 'true');
  act(() => useEditorStore.setState({ activeTabId: code.id }));
  expect(screen.queryByRole('tab', { name: 'Outline' })).not.toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');
  act(() => useEditorStore.setState({ activeTabId: markdown.id }));
  expect(screen.getByRole('tab', { name: 'Outline' })).toHaveAttribute('aria-selected', 'true');
});
