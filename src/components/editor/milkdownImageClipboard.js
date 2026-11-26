import i18n from '@/i18n';
import useNotificationStore from '@store/useNotificationStore';
import { loadMarkdownImageSrc } from '@utils/markdownAssets';
import { invoke } from '@tauri-apps/api/core';

export function selectedImageSource({ doc, selection }) {
  if (selection.empty) return '';
  const node = selection.node ?? doc.nodeAt(selection.from);
  return node?.type.name === 'image' && node.nodeSize === selection.to - selection.from
    ? node.attrs.src
    : '';
}

async function imageBlob(src, documentPath) {
  const remote = /^(?:https?:\/\/|\/\/)/i.test(src);
  if (remote) src = new URL(src, window.location.href).href;
  const { src: url, objectUrl } = await loadMarkdownImageSrc(src, documentPath);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Image request failed: ${response.status}`);
    return await response.blob();
  } catch (error) {
    if (!remote || !window.__TAURI_INTERNALS__) throw error;
    // Image hosts can permit display in <img> while denying WebView fetches.
    const result = await invoke('download_clipboard_image', { url: src });
    const bytes = Uint8Array.from(atob(result.content_base64), (char) => char.charCodeAt(0));
    return new Blob([bytes], { type: result.mime_type });
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

async function pngBlob(src, documentPath) {
  const blob = await imageBlob(src, documentPath);
  // Decode before writing so the clipboard receives an actual raster image
  // even when a host omits the MIME type or serves JPEG, WebP, or SVG.
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((png) => {
        if (png) resolve(png);
        else reject(new Error('Unable to encode clipboard image'));
      }, 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function copyMarkdownImage(src, documentPath) {
  const { notify } = useNotificationStore.getState();
  try {
    if (!navigator.clipboard?.write || !window.ClipboardItem) throw new Error('Clipboard unavailable');
    // Start the write in the copy/click handler while user activation is
    // available. ClipboardItem waits for the file or network read.
    const png = pngBlob(src, documentPath);
    void png.catch(() => {});
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    notify('success', i18n.t('media.imageCopied'), '', 2500);
  } catch {
    notify('error', i18n.t('media.imageCopyFailed'), '', 2500);
  }
}
