import useConfigStore from '@store/useConfigStore';
import useEditorStore from '@store/useEditorStore';
import { openExternal } from '@utils/tauriApi';

// Accept external links without turning relative Markdown paths into web URLs.
export function externalLink(value) {
  const text = String(value || '').trim();
  if (!/^(https?:|mailto:)/i.test(text)) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'mailto:' || url.hostname ? url.href : null;
  } catch { return null; }
}

export async function openEditorLink(url, { browserFallback = false } = {}) {
  if (/^https?:\/\//i.test(url) && useConfigStore.getState().openLinksInEditor) {
    useEditorStore.getState().openWebTab(url);
    return;
  }
  if (browserFallback && !window.__TAURI_INTERNALS__) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  return openExternal(url);
}
