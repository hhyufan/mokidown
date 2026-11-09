// Select the runtime before importing any editor, session or extension modules.
import '@utils/storageMigration';
import { invoke } from '@utils/tauriInvoke';
import useConfigStore from '@store/useConfigStore';

if (window.__TAURI_INTERNALS__) {
  const unsubscribe = useConfigStore.subscribe((state, previous) => {
    if (state.associatedOpenMode !== previous.associatedOpenMode) {
      void invoke('set_associated_open_mode', {
        mode: state.associatedOpenMode === 'reader' ? 'reader' : 'editor',
      }).catch((error) => console.error('[reader] Could not save open mode:', error));
    }
  });
  if (import.meta.hot) import.meta.hot.dispose(unsubscribe);
}

async function boot() {
  const params = new URLSearchParams(location.search);
  if (params.has('drag-preview')) {
    const { mountDragPreview } = await import('./dragPreview');
    await mountDragPreview();
    return;
  }
  let document = null;
  if (window.__TAURI_INTERNALS__) {
    document = await invoke('reader_bootstrap', {
      mode: useConfigStore.getState().associatedOpenMode === 'reader' ? 'reader' : 'editor',
      editor: params.has('editor'),
    });
  } else if (params.has('reader')) {
    // Browser QA uses real content supplied through the URL, never a restored workspace.
    document = { id: 'reader-preview', name: params.get('name') || 'Markdown.md',
      path: '', content: params.get('content') || '', modified: false };
  }
  if (document) {
    const { mountReader } = await import('./readerMain');
    mountReader(document);
  } else {
    await import('./mainEditor');
  }
}

void boot().catch((error) => {
  console.error('[startup] Could not select window runtime:', error);
  window.dispatchEvent(new ErrorEvent('error', { message: error.message, error }));
});
