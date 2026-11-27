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

async function imageUrl(src, documentPath) {
  const remote = /^(?:https?:\/\/|\/\/)/i.test(src);
  if (remote) src = new URL(src, window.location.href).href;
  const { src: url, objectUrl } = await loadMarkdownImageSrc(src, documentPath);
  // Local files and embedded images are already displayable URLs. Fetching
  // them again requires connect-src permission even when img-src allows them.
  if (!remote) return { url, objectUrl };
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Image request failed: ${response.status}`);
    const image = URL.createObjectURL(await response.blob());
    return { url: image, objectUrl: image };
  } catch (error) {
    if (!remote || !window.__TAURI_INTERNALS__) throw error;
    // Image hosts can permit display in <img> while denying WebView fetches.
    const result = await invoke('download_clipboard_image', { url: src });
    const bytes = Uint8Array.from(atob(result.content_base64), (char) => char.charCodeAt(0));
    const image = URL.createObjectURL(new Blob([bytes], { type: result.mime_type }));
    return { url: image, objectUrl: image };
  }
}

async function pngBlob(src, documentPath) {
  // Decode before writing so the clipboard receives an actual raster image
  // even when a host omits the MIME type or serves JPEG, WebP, or SVG.
  const { url, objectUrl } = await imageUrl(src, documentPath);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);
    const png = await new Promise((resolve, reject) => {
      canvas.toBlob((png) => {
        if (png) resolve(png);
        else reject(new Error('Unable to encode clipboard image'));
      }, 'image/png');
    });
    return { png, canvas };
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

function asBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function clipboardBitmap(canvas) {
  const { width, height } = canvas;
  if (width * height * 4 > 16 * 1024 * 1024) return null;
  const header = new DataView(new ArrayBuffer(124));
  header.setUint32(0, header.byteLength, true);
  header.setInt32(4, width, true);
  header.setInt32(8, -height, true);
  header.setUint16(12, 1, true);
  header.setUint16(14, 32, true);
  header.setUint32(16, 3, true); // BI_BITFIELDS
  header.setUint32(20, width * height * 4, true);
  header.setUint32(40, 0x00ff0000, true);
  header.setUint32(44, 0x0000ff00, true);
  header.setUint32(48, 0x000000ff, true);
  header.setUint32(52, 0xff000000, true);
  header.setUint32(56, 0x73524742, true); // LCS_sRGB
  header.setUint32(108, 4, true); // LCS_GM_IMAGES
  const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);
  for (let i = 0; i < data.length; i += 4) {
    const red = data[i];
    data[i] = data[i + 2];
    data[i + 2] = red;
  }
  return new Blob([header.buffer, data]);
}

export async function copyMarkdownImage(src, documentPath) {
  const { notify } = useNotificationStore.getState();
  const image = pngBlob(src, documentPath);
  void image.catch(() => {});
  try {
    try {
      if (!navigator.clipboard?.write || !window.ClipboardItem)
        throw new Error('Clipboard unavailable');
      // Initiate the write before the decode completes to preserve activation.
      const png = image.then((result) => result.png);
      void png.catch(() => {});
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    } catch (error) {
      if (!window.__TAURI_INTERNALS__ || !/Windows/i.test(navigator.userAgent)) throw error;
      const { png, canvas } = await image;
      const bitmap = clipboardBitmap(canvas);
      const [contentBase64, dibBase64] = await Promise.all([
        asBase64(png),
        bitmap ? asBase64(bitmap) : null,
      ]);
      await invoke('write_clipboard_image', { contentBase64, dibBase64 });
    }
    notify('success', i18n.t('media.imageCopied'), '', 2500);
  } catch {
    notify('error', i18n.t('media.imageCopyFailed'), '', 2500);
  }
}
