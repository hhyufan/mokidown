import { beforeEach, expect, it, vi } from 'vitest';
import { getDirectoryContents } from '@utils/tauriApi';
import { inspectProjectChildren, projectDirectoryProvider } from './projectDirectories';

vi.mock('@utils/tauriApi', () => ({ getDirectoryContents: vi.fn(), closeDirectoryIndex: vi.fn(), openDirectoryIndex: vi.fn(), readDirectoryPage: vi.fn(), locateDirectoryEntry: vi.fn() }));
vi.mock('./workspaceFiles', () => ({ usesDirectoryIndex: () => false }));
beforeEach(() => vi.clearAllMocks());

it('annotates direct children before publishing a legacy parent listing without mutating it', async () => {
  const entries = [
    { name: 'empty', path: '/root/empty', is_dir: true },
    { name: 'denied', path: '/root/denied', is_dir: true },
    { name: 'full', path: '/root/full', is_dir: true },
    { name: 'a.md', path: '/root/a.md', is_dir: false },
  ];
  getDirectoryContents.mockImplementation(async (path) => {
    if (path === '/root') return entries;
    if (path.endsWith('/denied')) throw new Error('Access denied');
    return path.endsWith('/empty') ? [] : [{ name: 'child.md' }];
  });
  const source = projectDirectoryProvider({ sortBy: 'name', sortOrder: 'asc' })('/root');
  const { items, total } = await source.ready;
  expect(total).toBe(4);
  expect(items.find((item) => item.name === 'empty').directoryState).toBe('empty');
  expect(items.find((item) => item.name === 'denied')).toMatchObject({ directoryState: 'unreadable', directoryError: 'Error: Access denied' });
  expect(items.find((item) => item.name === 'full').directoryState).toBe('readable');
  expect(entries.every((item) => !item.directoryState)).toBe(true);
  expect(getDirectoryContents).not.toHaveBeenCalledWith('/root/a.md');
});

it('bounds checks to four concurrent reads and stops queued checks after cancellation', async () => {
  const entries = Array.from({ length: 100 }, (_, index) => ({ path: `/root/d${index}`, is_dir: true }));
  let active = true;
  const pending = [];
  getDirectoryContents.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  const inspection = inspectProjectChildren(entries, () => active);
  expect(getDirectoryContents).toHaveBeenCalledTimes(4);
  active = false;
  pending.forEach((resolve) => resolve([]));
  await inspection;
  expect(getDirectoryContents).toHaveBeenCalledTimes(4);
});
