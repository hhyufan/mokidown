import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import useExtensionStore, { OFFICIAL_EXTENSIONS } from './useExtensionStore';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { useExtensionStore.setState({ installed: [], activeId: null }); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it('installs an official package from the shipped asset without GitHub or native network requests', async () => {
  const descriptor = OFFICIAL_EXTENSIONS[0];
  const text = readFileSync(resolve(import.meta.dirname, '../../public', descriptor.bundledUrl), 'utf8');
  const fetchAsset = vi.fn(async () => ({ ok: true, text: async () => text }));
  vi.stubGlobal('fetch', fetchAsset); vi.stubGlobal('crypto', webcrypto);
  await useExtensionStore.getState().ensureInstalled(descriptor.id);
  expect(fetchAsset).toHaveBeenCalledTimes(1);
  expect(fetchAsset.mock.calls[0][0].pathname).toBe(`/${descriptor.bundledUrl}`);
  expect(invoke).not.toHaveBeenCalled();
  expect(useExtensionStore.getState().installed[0]).toMatchObject({ enabled: false, package: { id: descriptor.id, version: descriptor.version } });
  await useExtensionStore.getState().ensureInstalled(descriptor.id);
  expect(fetchAsset).toHaveBeenCalledTimes(1);
});
it('retains a running installed version when an update fails verification', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const descriptor = OFFICIAL_EXTENSIONS[0];
  useExtensionStore.getState().install({ format:'mokidown-extension-v1',id:descriptor.id,name:'Existing',version:'1.0.0',permissions:[],fileExtensions:[],script:'old' });
  useExtensionStore.getState().toggle(descriptor.id,true);
  const previous = useExtensionStore.getState().installed[0];
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,text:async()=>'{"bad":true}'})));
  await expect(useExtensionStore.getState().updatePlugin(descriptor)).rejects.toThrow();
  expect(useExtensionStore.getState().installed[0]).toBe(previous);
  expect(previous.enabled).toBe(true);
});
it('rejects invalid configuration before stopping a running plugin', async () => {
  useExtensionStore.getState().install({format:'mokidown-extension-v1',id:'test.config',name:'Test',version:'1',permissions:[],fileExtensions:[],script:''});
  useExtensionStore.getState().toggle('test.config',true);
  await expect(useExtensionStore.getState().configure('test.config',{endpoint:'javascript:alert(1)'},'')).rejects.toThrow();
  expect(useExtensionStore.getState().installed[0].enabled).toBe(true);
});
it('offers a newer GitHub release without requiring the bundled URL', async () => {
  const descriptor = OFFICIAL_EXTENSIONS[0];
  useExtensionStore.getState().install({format:'mokidown-extension-v1',id:descriptor.id,name:'Existing',version:descriptor.version,permissions:[],fileExtensions:[],script:''});
  vi.mocked(invoke).mockResolvedValue({status:200,body:JSON.stringify([{id:descriptor.id,name:descriptor.name,version:'99.0.0',url:'https://github.com/example/package.json',sha256:'a'.repeat(64)}])});
  const updates = await useExtensionStore.getState().checkUpdates();
  expect(updates[0].entry.version).toBe('99.0.0');
  expect(updates[0].entry.bundledUrl).toBeUndefined();
});
