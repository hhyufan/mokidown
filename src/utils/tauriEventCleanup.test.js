import { afterEach, expect, it, vi } from 'vitest';
import { listen } from '@tauri-apps/api/event';
import { installTauriEventCleanupGuard } from './tauriEventCleanup';

afterEach(() => vi.unstubAllGlobals());

it('unregisters natively when the old WebView listener is already gone', async () => {
  const unregisterListener = vi.fn(() => {
    throw new TypeError("Cannot read properties of undefined (reading 'handlerId')");
  });
  const invoke = vi.fn().mockResolvedValueOnce(42).mockResolvedValueOnce(undefined);
  vi.stubGlobal('__TAURI_EVENT_PLUGIN_INTERNALS__', { unregisterListener });
  vi.stubGlobal('__TAURI_INTERNALS__', { transformCallback: () => 1, invoke });

  installTauriEventCleanupGuard();
  installTauriEventCleanupGuard();
  const unlisten = await listen('reader:preview-update', () => {});
  await unlisten();

  expect(unregisterListener).toHaveBeenCalledExactlyOnceWith('reader:preview-update', 42);
  expect(invoke).toHaveBeenLastCalledWith('plugin:event|unlisten', {
    event: 'reader:preview-update', eventId: 42,
  }, undefined);
});

it('keeps unexpected listener cleanup errors visible', () => {
  const bridge = {
    unregisterListener() { throw new TypeError('unexpected failure'); },
  };
  installTauriEventCleanupGuard(bridge);
  expect(() => bridge.unregisterListener('reader:preview-update', 42)).toThrow('unexpected failure');
});
