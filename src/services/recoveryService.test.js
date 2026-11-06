import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import useEditorStore from '@store/useEditorStore';
import { clearBuffer, registerEditorBufferFlusher, setBuffer } from '@utils/editorBuffer';
import { clearRecoverySnapshot, readFileContent, readRecoverySnapshot, writeRecoverySnapshot } from '@utils/tauriApi';
import { flushRecoverySnapshot, loadRecoveryCandidates } from './recoveryService';

vi.mock('@utils/tauriApi', () => ({
  clearRecoverySnapshot: vi.fn(), readFileContent: vi.fn(), readRecoverySnapshot: vi.fn(), writeRecoverySnapshot: vi.fn(),
  historyCapture: vi.fn(),
}));
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  window.__TAURI_INTERNALS__ = {};
  vi.clearAllMocks();
  clearBuffer('/recovery.md');
  useEditorStore.setState({ tabs: [], tabRenderList: [], activeTabId: null });
  useEditorStore.getState().openFile({ path: '/recovery.md', name: 'recovery.md', content: 'base' });
  setBuffer('/recovery.md', 'draft');
  useEditorStore.getState().markTabDirty('/recovery.md');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete window.__TAURI_INTERNALS__; });

it('does not overwrite a saved clean recovery state with an older pending hash operation', async () => {
  let finish, entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const blocked = new Promise((resolve) => { finish = resolve; });
  const digest = webcrypto.subtle.digest.bind(webcrypto.subtle);
  vi.spyOn(webcrypto.subtle, 'digest').mockImplementationOnce(async (...args) => {
    entered(); await blocked; return digest(...args);
  });
  const old = flushRecoverySnapshot();
  await started;
  setBuffer('/recovery.md', 'newer content now saved');
  useEditorStore.getState().markTabSaved('/recovery.md', 'newer content now saved');
  await flushRecoverySnapshot();
  finish(); await old;
  expect(clearRecoverySnapshot).toHaveBeenCalled();
  expect(writeRecoverySnapshot).not.toHaveBeenCalled();
});

it('reads the current editor before hashing a recovery draft, then ignores it once disk matches', async () => {
  const unregister = registerEditorBufferFlusher(() => '/recovery.md', () => setBuffer('/recovery.md', 'last input'));
  await flushRecoverySnapshot(); unregister();
  const snapshot = writeRecoverySnapshot.mock.calls.at(-1)[0];
  expect(snapshot.tabs[0].content).toBe('last input');
  readRecoverySnapshot.mockResolvedValue(snapshot);
  readFileContent.mockResolvedValue({ success: true, content: 'last input' });
  expect(await loadRecoveryCandidates()).toEqual([]);
});

it('provides the full disk version for a Monaco comparison without modifying the recovery draft', async () => {
  await flushRecoverySnapshot();
  const snapshot = writeRecoverySnapshot.mock.calls.at(-1)[0];
  readRecoverySnapshot.mockResolvedValue(snapshot);
  const diskContent = `${'unchanged line\n'.repeat(80)}disk version`;
  readFileContent.mockResolvedValue({ success: true, content: diskContent });
  const candidates = await loadRecoveryCandidates();
  expect(candidates[0]).toMatchObject({ content: 'draft', diskContent, diskState: 'changed' });
  expect(snapshot.tabs[0]).not.toHaveProperty('diskContent');
});

it('keeps a draft without reading binary disk content into its comparison', async () => {
  await flushRecoverySnapshot();
  readRecoverySnapshot.mockResolvedValue(writeRecoverySnapshot.mock.calls.at(-1)[0]);
  readFileContent.mockResolvedValue({ success: false, blockedReason: 'binary' });
  const candidates = await loadRecoveryCandidates();
  expect(candidates[0]).toMatchObject({ content: 'draft', diskState: 'blocked' });
  expect(candidates[0]).not.toHaveProperty('diskContent');
});
