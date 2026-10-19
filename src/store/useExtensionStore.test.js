import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import useExtensionStore, { OFFICIAL_EXTENSIONS } from './useExtensionStore';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { useExtensionStore.setState({ installed: [], pendingUpdates: [], updateState: null }); vi.unstubAllGlobals(); vi.mocked(invoke).mockReset(); });
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

for (const source of ['old package', 'missing asset', 'fetch failure']) {
  it(`updates from the verified release when the bundled source contains ${source}`, async () => {
    vi.stubGlobal('crypto', webcrypto);
    const descriptor = OFFICIAL_EXTENSIONS[0];
    const currentText = readFileSync(resolve(import.meta.dirname, '../../public', descriptor.bundledUrl), 'utf8');
    const oldText = JSON.stringify({ format: 'mokidown-extension-v1', id: descriptor.id, name: 'Previous', version: '1.0.0', permissions: [], fileExtensions: [], script: 'old' });
    useExtensionStore.getState().install(JSON.parse(oldText));
    useExtensionStore.setState((state) => ({ installed: state.installed.map((item) => ({ ...item, enabled: true, settings: { endpoint: 'https://service.example', workspace: '/notes' } })) }));
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (source === 'fetch failure') throw new Error('Unavailable');
      return { ok: source !== 'missing asset', status: 404, text: async () => oldText };
    }));
    vi.mocked(invoke).mockResolvedValue({ status: 200, body: currentText });
    await useExtensionStore.getState().updatePlugin(descriptor);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('extension_http_request', { url: descriptor.url, method: 'GET', body: null, credentialId: null });
    expect(useExtensionStore.getState().installed[0]).toMatchObject({ enabled: true, packageDigest: descriptor.sha256, package: { version: descriptor.version }, settings: { endpoint: 'https://service.example', workspace: '/notes' } });
  });
}

it('retains the enabled package and settings when neither source matches the catalog', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const descriptor = OFFICIAL_EXTENSIONS[0];
  const oldText = JSON.stringify({ format: 'mokidown-extension-v1', id: descriptor.id, name: 'Previous', version: '1.0.0', permissions: [], fileExtensions: [], script: 'old' });
  useExtensionStore.getState().install(JSON.parse(oldText));
  useExtensionStore.getState().toggle(descriptor.id, true);
  const previous = useExtensionStore.getState().installed[0];
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => oldText })));
  vi.mocked(invoke).mockResolvedValue({ status: 200, body: oldText });
  await expect(useExtensionStore.getState().updatePlugin(descriptor)).rejects.toThrow('PLUGIN_CHECKSUM_MISMATCH');
  expect(useExtensionStore.getState().installed[0]).toBe(previous);
  expect(previous.enabled).toBe(true);
  expect(useExtensionStore.getState().updateState.stage).toBe('error');
});
