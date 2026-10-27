import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import useEditorStore from '@store/useEditorStore';
import { clearBuffer, setBuffer } from '@utils/editorBuffer';
import { useKnowledgeTrees } from './useKnowledgeTrees';
import { readFileContent } from '@utils/tauriApi';

vi.mock('@utils/tauriApi', () => ({ readFileContent: vi.fn() }));
beforeEach(() => {
  useEditorStore.setState({ tabs: [] });
  readFileContent.mockReset();
  readFileContent.mockResolvedValue({ success: false });
});
afterEach(() => { cleanup(); clearBuffer('tree'); });

it('loads inline, external references and the first companion, using unsaved buffers', async () => {
  useEditorStore.setState({ tabs: [{ id: 'tree', path: '/notes/trees/shared.mgtree', content: 'Old' }] });
  setBuffer('tree', 'Live >js[2]');
  readFileContent.mockImplementation(async (path) => ({ success: path === '/notes/main.mgtree', content: 'Companion' }));
  const { result } = renderHook(() => useKnowledgeTrees('/notes/main.md', '```tree\nInline\n```\n```tree\n@tree(trees/shared)\n```'));
  await waitFor(() => expect(result.current.map((tree) => tree.source)).toEqual(['Inline', 'Live >js[2]', 'Companion']));
  await act(async () => { setBuffer('tree', 'Updated'); });
  await waitFor(() => expect(result.current[1].source).toBe('Updated'));
});

it('discards late reads from another document and clears absent companions', async () => {
  let finish;
  readFileContent.mockImplementation((path) => path === '/notes/old.mgtree'
    ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve({ success: false }));
  const { result, rerender } = renderHook(({ path }) => useKnowledgeTrees(path, ''), { initialProps: { path: '/notes/old.md' } });
  rerender({ path: '/notes/new.md' });
  await act(async () => finish({ success: true, content: 'Wrong document' }));
  await waitFor(() => expect(result.current).toEqual([]));
});
