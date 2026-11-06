import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { historyCapture, readFileContent, readFileHead } from './tauriApi';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

it.each(['binary', 'too-large', 'invalid-encoding', 'unreadable', 'not-file'])('blocks %s reads and subsequent history until the disk is readable again', async (kind) => {
  const path = `/workspace/${kind}.txt`;
  invoke.mockRejectedValueOnce({ kind, message: 'cannot read as text' });
  expect(await readFileContent(path)).toMatchObject({ success: false, blockedReason: kind });
  await historyCapture(path, 'preserved buffer', { force: true });
  expect(invoke.mock.calls.map(([command]) => command)).toEqual(['read_file_content']);
  invoke.mockResolvedValueOnce({ success: true, content: 'readable again' });
  expect(await readFileContent(path)).toMatchObject({ success: true, content: 'readable again' });
  invoke.mockResolvedValueOnce(undefined);
  await historyCapture(path, 'readable again');
  expect(invoke).toHaveBeenLastCalledWith('history_capture', { filePath: path, content: 'readable again', force: false });
});

it('propagates a failed head read instead of substituting empty text', async () => {
  invoke.mockRejectedValueOnce(new Error('permission denied'));
  await expect(readFileHead('/denied')).rejects.toThrow('permission denied');
});
