import { invoke } from '@utils/tauriInvoke';

export function hasNativeMenuClipboard() {
  return Boolean(window.__TAURI_INTERNALS__) && /^Win/i.test(navigator.platform);
}

export function readMenuClipboardText() {
  return hasNativeMenuClipboard() ? invoke('read_clipboard_for_paste') : navigator.clipboard.readText();
}
