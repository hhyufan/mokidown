import { invoke } from '@utils/tauriInvoke';

export function hasNativeMenuClipboard() {
  return Boolean(window.__TAURI_INTERNALS__) && /^Win/i.test(navigator.platform);
}

export async function readMenuClipboardText() {
  if (!hasNativeMenuClipboard()) return navigator.clipboard.readText();
  const { text } = await invoke('read_clipboard_for_paste', { includeImage: false });
  return text;
}

export async function readMenuClipboard() {
  if (hasNativeMenuClipboard()) {
    const { text, image } = await invoke('read_clipboard_for_paste', { includeImage: true });
    const files = image
      ? [new File([Uint8Array.from(atob(image.contentBase64), (byte) => byte.charCodeAt(0))], '', {
          type: image.mime,
        })]
      : [];
    return { text, files };
  }
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
