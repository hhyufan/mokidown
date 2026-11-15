const cleanupGuard = Symbol.for('mokidown.tauriEventCleanup');

export function installTauriEventCleanupGuard(bridge = window.__TAURI_EVENT_PLUGIN_INTERNALS__) {
  const unregister = bridge?.unregisterListener;
  if (typeof unregister !== 'function' || bridge[cleanupGuard]) return;
  bridge.unregisterListener = function unregisterListener(event, id) {
    try {
      unregister.call(this, event, id);
    } catch (error) {
      // Tauri 2.10 can look up a listener from an earlier WebView context.
      // Let the SDK continue to the native unlisten even if its JS entry is gone.
      if (!(error instanceof TypeError && /\bhandlerId\b/.test(error.message))) throw error;
    }
  };
  bridge[cleanupGuard] = true;
}
