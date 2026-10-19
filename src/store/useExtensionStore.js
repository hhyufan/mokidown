import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import officialCatalog from '@/configs/service-plugins.json';
import { validatePluginPackage, verifyPluginPackage } from '../../shared/plugin-package.mjs';
import { developmentPackageUrl, readDevelopmentPackage } from '@/services/pluginDevelopment';

export const OFFICIAL_EXTENSIONS = officialCatalog;

export const validateExtensionPackage = validatePluginPackage;
const installations = new Map();

const useExtensionStore = create(persist((set, get) => ({
  installed: [], catalog: [], error: '',
  catalogUrl: '',
  pendingUpdates: [],
  updateState: null,
  runtimeErrors: {},
  developmentSources: [],
  connectDevelopment: async (value) => {
    const url = developmentPackageUrl(value);
    const { pkg, digest } = await readDevelopmentPackage(url);
    get().install(pkg, { digest });
    set((state) => ({ installed: state.installed.map((entry) => entry.package.id === pkg.id ? { ...entry, enabled: true, development: true } : entry), developmentSources: [...state.developmentSources.filter((entry) => entry.id !== pkg.id), { id: pkg.id, url, token: crypto.randomUUID(), error: '' }] }));
  },
  refreshDevelopment: async (id) => {
    const source = get().developmentSources.find((item) => item.id === id);
    const previous = get().installed.find((item) => item.package.id === id);
    if (!source || !previous?.enabled) return;
    try {
      const { pkg, digest } = await readDevelopmentPackage(source.url, previous.package);
      if (get().developmentSources.find((item) => item.id === id)?.token !== source.token || get().installed.find((item) => item.package.id === id) !== previous) return;
      if (digest !== previous.packageDigest) {
        get().install(pkg, { digest });
        set((state) => ({ installed: state.installed.map((entry) => entry.package.id === id ? { ...entry, enabled: true, development: true } : entry) }));
      }
      set((state) => ({ developmentSources: state.developmentSources.map((item) => item.id === id ? { ...item, error: '' } : item) }));
    } catch (error) {
      set((state) => ({ developmentSources: state.developmentSources.map((item) => item.token === source.token ? { ...item, error: String(error?.message || error) } : item) }));
    }
  },
  disconnectDevelopment: (id) => {
    get().toggle(id, false);
    set((state) => ({ developmentSources: state.developmentSources.filter((item) => item.id !== id) }));
  },
  setRuntimeError: (id, message) => set((state) => ({ runtimeErrors: { ...state.runtimeErrors, [id]: message } })),
  clearUpdateState: () => set({ updateState: null }),
  setCatalogUrl: (catalogUrl) => set({ catalogUrl }),
  // Compare the bundled catalog (the source of truth for official plugins)
  // against what is installed, so update checks can be offered to the user.
  checkUpdates: async () => {
    const startedAt = Date.now();
    set({ updateState: { id: 'catalog', name: '', stage: 'checking' } });
    const installed = get().installed;
    const candidates = await Promise.all(OFFICIAL_EXTENSIONS.map(async (builtin) => {
      if (!builtin.updateCatalog) return builtin;
      try {
        const response = await invoke('extension_http_request', { url: builtin.updateCatalog, method: 'GET', body: null, credentialId: null });
        if (response.status !== 200) return builtin;
        const catalog = JSON.parse(response.body);
        const remote = Array.isArray(catalog) && catalog.find((item) => item.id === builtin.id);
        if (!remote || !/^https:\/\//.test(remote.url || '') || !/^[a-f0-9]{64}$/.test(remote.sha256 || '') || !/^\d+\.\d+\.\d+$/.test(remote.version || '')) return builtin;
        const parts = remote.version.split('.').map(Number), local = builtin.version.split('.').map(Number);
        const changed = parts.findIndex((part, index) => part !== local[index]);
        return changed >= 0 && parts[changed] > local[changed] ? remote : builtin;
      } catch { return builtin; } // Bundled packages remain available offline.
    }));
    const updates = candidates.map((entry) => {
      const current = installed.find((item) => item.package.id === entry.id);
      if (current && /^\d+\.\d+\.\d+$/.test(current.package.version)) {
        const parts = entry.version.split('.').map(Number), previous = current.package.version.split('.').map(Number);
        const changed = parts.findIndex((part, index) => part !== previous[index]);
        if (changed >= 0 && parts[changed] < previous[changed]) return null;
      }
      if (!current || current.package.version === entry.version && (!current.packageDigest || current.packageDigest === entry.sha256)) return null;
      return { entry, currentVersion: current?.package.version || null };
    }).filter(Boolean);
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 500 - (Date.now() - startedAt))));
    set({ pendingUpdates: updates, updateState: null });
    return updates;
  },
  updatePlugin: async (entry) => {
    const previous = get().installed.find((item) => item.package.id === entry.id);
    set({ updateState: { id: entry.id, name: entry.name, stage: 'updating' } });
    try {
      await get().installFromCatalog(entry);
      if (previous?.enabled) get().toggle(entry.id, true);
      set((state) => ({
        pendingUpdates: state.pendingUpdates.filter((item) => item.entry.id !== entry.id),
        updateState: { id: entry.id, name: entry.name, stage: 'done' },
      }));
    } catch (error) {
      set({ updateState: { id: entry.id, name: entry.name, stage: 'error', error: String(error?.message || error) } });
      throw error;
    }
  },
  refreshCatalog: async () => {
    try {
      if (!get().catalogUrl.trim()) { set({ catalog: [], error: '' }); return; }
      const response = await invoke('extension_http_request', { url: get().catalogUrl, method: 'GET', body: null, credentialId: null });
      if (response.status !== 200) throw new Error(`Catalog HTTP ${response.status}`);
      const catalog = JSON.parse(response.body);
      if (!Array.isArray(catalog) || catalog.some((item) => !item.id || !item.name || !/^https:\/\//.test(item.url || '') || !/^[a-f0-9]{64}$/.test(item.sha256 || ''))) throw new Error('Invalid service plugin catalog');
      set({ catalog, error: '' });
    } catch (error) { set({ error: String(error) }); }
  },
  installFromCatalog: async (entry) => {
    let verified, bundledError;
    if (entry.bundledUrl) {
      try {
        const resource = new URL(entry.bundledUrl, document.baseURI);
        resource.searchParams.set('integrity', entry.sha256);
        const response = await fetch(resource, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Bundled plugin resource unavailable (${response.status})`);
        verified = await verifyPluginPackage(await response.text(), entry);
      } catch (error) { bundledError = error; }
    }
    // An older application/cache can still carry a previous bundled package.
    // The remote release must pass the same descriptor and integrity checks.
    if (!verified) {
      if (!entry.url) throw bundledError || new Error('Plugin package URL is missing');
      const response = await invoke('extension_http_request', { url: entry.url, method: 'GET', body: null, credentialId: null });
      if (response.status !== 200) throw new Error(`Package HTTP ${response.status}`);
      verified = await verifyPluginPackage(response.body, entry);
    }
    const { pkg, digest } = verified;
    get().install(pkg, { digest });
  },
  installPackage: async (text) => { const { pkg, digest } = await verifyPluginPackage(text); get().install(pkg, { digest }); },
  ensureInstalled: async (id) => {
    if (get().installed.some((entry) => entry.package.id === id)) return;
    const bundled = OFFICIAL_EXTENSIONS.find((entry) => entry.id === id);
    if (!bundled) throw new Error('Plugin not installed');
    if (!installations.has(id)) installations.set(id, get().installFromCatalog(bundled).finally(() => installations.delete(id)));
    await installations.get(id);
  },
  install: (pkg, { digest } = {}) => {
    const normalized = validateExtensionPackage(pkg);
    set((state) => ({ installed: [...state.installed.filter((item) => item.package.id !== pkg.id), { package: normalized, packageDigest: digest || null, enabled: false, settings: state.installed.find((item) => item.package.id === pkg.id)?.settings || {} }] }));
  },
  configure: async (id, settings, credential) => {
    await get().ensureInstalled(id);
    const wasEnabled = Boolean(get().installed.find((item) => item.package.id === id)?.enabled);
    // Restart the running realm for the new settings, then restore its state:
    // saving a key must not silently disable the plugin.
    if (settings.endpoint) {
      const url = new URL(settings.endpoint);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid service URL');
      settings = { ...settings, endpoint: url.toString().replace(/\/+$/, '') };
    }
    if (credential) await invoke('extension_set_credential', { id, value: credential });
    if (wasEnabled) get().toggle(id, false);
    set((state) => ({ installed: state.installed.map((item) => item.package.id === id ? { ...item, settings } : item) }));
    if (wasEnabled) get().toggle(id, true);
  },
  toggle: (id, enabled) => set((state) => ({ installed: state.installed.map((item) => item.package.id === id ? { ...item, enabled } : item) })),
  uninstall: async (id) => {
    get().disconnectDevelopment(id);
    get().toggle(id, false);
    await invoke('extension_delete_credential', { id });
    set((state) => ({ installed: state.installed.filter((item) => item.package.id !== id) }));
  },
}), {
  name: 'mokidown-service-extensions',
  partialize: ({ installed, catalogUrl }) => ({ installed, catalogUrl }),
  merge: (persisted, current) => ({ ...current, ...persisted, installed: (persisted?.installed || []).map((entry) => entry.development ? { ...entry, enabled: false } : entry), catalogUrl: persisted?.catalogUrl?.includes('/hhyufan/mokidown/main/plugins/catalog.json') ? '' : persisted?.catalogUrl || '' }),
}));

export default useExtensionStore;
