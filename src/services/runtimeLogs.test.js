import { afterEach, expect, it, vi } from 'vitest';
import { invoke as nativeInvoke } from '@tauri-apps/api/core';
import { invoke } from '@utils/tauriInvoke';
import { startNativeLogPolling, useRuntimeLogStore } from './runtimeLogs';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

afterEach(() => {
  delete window.__TAURI_INTERNALS__;
  useRuntimeLogStore.setState({ entries: [], open: false });
  vi.restoreAllMocks();
});

it('records a Tauri rejection and rethrows it without recording invocation arguments', async () => {
  const failure = { message: 'Permission denied', kind: 'unreadable' };
  nativeInvoke.mockRejectedValueOnce(failure);
  await expect(invoke('open_file', { contents: 'private document' })).rejects.toBe(failure);
  expect(useRuntimeLogStore.getState().entries).toEqual([expect.objectContaining({
    source: 'Tauri', level: 'error', detail: 'open_file', message: 'Permission denied',
  })]);
  expect(JSON.stringify(useRuntimeLogStore.getState().entries)).not.toContain('private document');
});

it('puts native warnings in the same log with the original source context', async () => {
  window.__TAURI_INTERNALS__ = {};
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  nativeInvoke.mockResolvedValueOnce([{
    id: 1, timestamp: Date.now(), level: 'warning', target: 'mokidown_lib::startup', message: 'Window handover',
  }]);
  const stop = startNativeLogPolling();
  try {
    await vi.waitFor(() => expect(useRuntimeLogStore.getState().entries).toEqual([
      expect.objectContaining({ source: 'Tauri', level: 'warning', detail: 'mokidown_lib::startup', message: 'Window handover' }),
    ]));
  } finally {
    stop();
  }
});
