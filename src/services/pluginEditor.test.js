import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import useEditorStore from '@store/useEditorStore';
import { clearBuffer, setBuffer } from '@utils/editorBuffer';
import { getPluginDocument, applyPluginEdits, registerPluginEditor, getPluginSelection, setPluginSelection } from './pluginEditor';
let stop;
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); useEditorStore.setState({tabs:[{id:'doc',name:'a.md',content:'hello'}],activeTabId:'doc'}); });
afterEach(() => { stop?.(); clearBuffer('doc'); useEditorStore.setState({tabs:[],activeTabId:null}); vi.unstubAllGlobals(); });
it('reads the unsaved buffer and applies matching UTF-16 edits through the editor', async () => {
  setBuffer('doc','hello 😀');
  const doc = await getPluginDocument(); expect(doc.content).toBe('hello 😀');
  const apply = vi.fn(); stop = registerPluginEditor(() => 'doc', apply);
  await applyPluginEdits({documentId:'doc',expectedChecksum:doc.checksum,edits:[{from:6,to:8,text:'world'}]});
  expect(apply).toHaveBeenCalledWith([{from:6,to:8,text:'world'}]);
});
it('rejects stale snapshots and overlapping ranges without invoking the editor', async () => {
  const doc = await getPluginDocument(); const apply = vi.fn(); stop = registerPluginEditor(() => 'doc', apply);
  setBuffer('doc','new content');
  await expect(applyPluginEdits({documentId:'doc',expectedChecksum:doc.checksum,edits:[{from:0,to:0,text:'x'}]})).rejects.toThrow('DOCUMENT_CHANGED');
  const current = await getPluginDocument();
  await expect(applyPluginEdits({documentId:'doc',expectedChecksum:current.checksum,edits:[{from:0,to:3,text:'x'},{from:2,to:4,text:'y'}]})).rejects.toThrow('non-overlapping');
  expect(apply).not.toHaveBeenCalled();
});

it('reads a requested document and guards UTF-16 selection changes with its checksum', async () => {
  setBuffer('doc', 'hello 😀');
  useEditorStore.setState({ activeTabId: 'other', tabs: [...useEditorStore.getState().tabs, { id: 'other', name: 'b.md', content: 'other' }] });
  const select = vi.fn();
  stop = registerPluginEditor(() => 'doc', vi.fn(), { getSelection: () => ({ from: 6, to: 8 }), setSelection: select });
  const snapshot = await getPluginDocument('doc'); expect(snapshot.content).toBe('hello 😀');
  expect(await getPluginSelection('doc')).toMatchObject({ documentId: 'doc', text: '😀', from: 6, to: 8, checksum: snapshot.checksum });
  await setPluginSelection({ documentId: 'doc', expectedChecksum: snapshot.checksum, from: 6, to: 8 });
  expect(select).toHaveBeenCalledWith({ from: 6, to: 8 });
  setBuffer('doc', 'changed');
  await expect(setPluginSelection({ documentId: 'doc', expectedChecksum: snapshot.checksum, from: 0 })).rejects.toThrow('DOCUMENT_CHANGED');
  expect(select).toHaveBeenCalledTimes(1);
});
