import { invoke } from '@utils/tauriInvoke';

export function hasNativeMenuClipboard() {
  return Boolean(window.__TAURI_INTERNALS__) && /^Win/i.test(navigator.platform);
}

export function readMenuClipboardText() {
  return hasNativeMenuClipboard() ? invoke('read_clipboard_for_paste') : navigator.clipboard.readText();
}

export async function readMenuClipboard() {
  const text = hasNativeMenuClipboard() ? await readMenuClipboardText() : '';
  if (text) return { text, files: [] };
  if (!navigator.clipboard?.read) return { text: await readMenuClipboardText(), files: [] };

  const items = await navigator.clipboard.read();
  const files = [];
  for (const item of items) {
    const type = item.types.find((type) => type.startsWith('image/'));
    if (type) files.push(new File([await item.getType(type)], '', { type }));
  }
  if (files.length) return { files, text: '' };
  const plain = items.find((item) => item.types.includes('text/plain'));
  const plainText = plain ? await (await plain.getType('text/plain')).text() : '';
  return { text: plainText, files };
}
