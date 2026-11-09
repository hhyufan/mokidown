import { listen } from '@tauri-apps/api/event';
import { invoke } from '@utils/tauriInvoke';

// Subscribe first, then reconcile bootstrap. A prepare arriving during the query
// must win over the older document returned by that query.
export async function subscribeReaderDocuments(onDocument, signal) {
  let revision = 0;
  const stop = await listen('reader:prepare', (event) => {
    revision += 1;
    if (!signal.aborted && event.payload) onDocument(event.payload);
  });
  if (signal.aborted) { stop(); return; }
  signal.addEventListener('abort', stop, { once: true });
  const initialRevision = revision;
  try {
    const document = await invoke('reader_current_document');
    if (!signal.aborted && revision === initialRevision && document) onDocument(document);
  } catch (error) {
    if (!signal.aborted) console.error('[reader] Could not reconcile prepared document:', error);
  }
}
