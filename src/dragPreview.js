import { invoke } from '@utils/tauriInvoke';
import { listen } from '@tauri-apps/api/event';
import { createDragPreviewElement } from './services/dragPreviewElement';
import './dragPreview.scss';

export { createDragPreviewElement };

export async function mountDragPreview() {
  let currentToken = null;
  const render = async (preview) => {
    if (!preview || preview.token === currentToken) return;
    currentToken = preview.token;
    const card = createDragPreviewElement(preview);
    document.getElementById('root').replaceChildren(card);
    await Promise.all([...card.querySelectorAll('img')].map((image) => image.decode().catch(() => {})));
    await document.fonts?.ready;
    if (currentToken !== preview.token) return;
    await invoke('drag_preview_ready', { token: preview.token });
  };
  // Subscribe before bootstrap so a first gesture during warm-up cannot be lost.
  const stop = await listen('reader:preview-update', (event) => { void render(event.payload).catch(console.error); });
  if (import.meta.hot) import.meta.hot.dispose(stop);
  await Promise.all([
    document.fonts?.load('12px Poppins'),
    document.fonts?.load('12px Source-HanSan'),
  ]);
  await render(await invoke('drag_preview_bootstrap'));
}
