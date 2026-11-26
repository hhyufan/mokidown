import { invoke } from '@tauri-apps/api/core';
import { parseJsonDocument } from '@utils/jsonDocument';
import { registerWebFile } from '@utils/tauriApi';
import useConfigStore from '@store/useConfigStore';
import { applySettingsSnapshot, getLocalSettingsSnapshot } from '@utils/settingsSnapshot';
import useExtensionStore from '@store/useExtensionStore';
import useLspStore, { validatePluginManifest } from '@store/useLspStore';
import { registerSettingsDocumentPath, settingsDocumentKind } from './settingsDocumentPaths';

const filenames = {
  imageHost: 'image-host.jsonc',
  languagePlugins: 'language-plugins.jsonc',
  servicePlugins: 'service-plugin-sources.jsonc',
  localSettings: 'local-settings.jsonc',
};
const storageKey = (kind) => `mokidown-document:${kind}`;
const endpoint = (value) =>
  /^https?:\/\//i.test(value || '') || /:[0-9]+(?:\/|$)/.test(value || '');
const asFile = (value) => `${JSON.stringify(value, null, 2)}\n`;
let imageHostRule = null;
const pending = new Map();

function initialContent(kind) {
  const config = useConfigStore.getState();
  switch (kind) {
    case 'imageHost': {
      const url = endpoint(config.imageDefaultDir) ? config.imageDefaultDir.trim() : '';
      if (config.imageUploadRule) {
        try {
          const rule = parseJsonDocument(config.imageUploadRule);
          if (!url) return rule?.url ? asFile({ ...rule, enabled: false }) : config.imageUploadRule;
          return rule?.url === url ? config.imageUploadRule : asFile({ ...rule, url });
        } catch {
          return config.imageUploadRule;
        }
      }
      return url
        ? asFile({
            url,
            method: 'POST',
            body: 'multipart',
            fileField: 'file',
            responsePath: 'data.url',
          })
        : '{\n  // "url": "https://example.com/upload",\n  // "headers": { "Authorization": "Bearer YOUR_TOKEN" }\n}\n';
    }
    case 'languagePlugins': {
      const { catalog, sources } = useLspStore.getState();
      return asFile({ sources, manifests: catalog });
    }
    case 'servicePlugins':
      return asFile({ catalogUrl: useExtensionStore.getState().catalogUrl });
    case 'localSettings':
      return asFile(getLocalSettingsSnapshot({ includeDeviceLocal: true }));
  }
}

function publishDocument(kind, content) {
  const config = parseJsonDocument(content);
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw new Error('settings.documents.invalidObject');
  switch (kind) {
    case 'localSettings':
      applySettingsSnapshot(config, { includeDeviceLocal: true });
      return () => {};
    case 'imageHost':
      if (
        config.url != null &&
        (typeof config.url !== 'string' || (config.url.trim() && !endpoint(config.url.trim())))
      )
        throw new Error('settings.documents.invalidImageHost');
      return () => {
        imageHostRule = config.enabled !== false && config.url?.trim() ? config : null;
        const previous = useConfigStore.getState();
        if (previous.imageUploadRule || endpoint(previous.imageDefaultDir)) {
          useConfigStore.setState({
            imageUploadRule: '',
            ...(endpoint(previous.imageDefaultDir) ? { imageDefaultDir: '' } : {}),
          });
        }
      };
    case 'languagePlugins': {
      const { sources = [], manifests = [] } = config;
      if (
        !Array.isArray(sources) ||
        sources.some((url) => typeof url !== 'string' || !/^https?:\/\//i.test(url)) ||
        !Array.isArray(manifests)
      )
        throw new Error('settings.documents.invalidPluginSources');
      const catalog = manifests.map(validatePluginManifest);
      return () =>
        useLspStore.setState((state) => ({
          sources: [...new Set(sources)],
          catalog,
          externalConfigLoaded: true,
          remoteCatalog: state.remoteCatalog.filter((entry) => sources.includes(entry.source)),
        }));
    }
    case 'servicePlugins': {
      const { catalogUrl = '' } = config;
      if (typeof catalogUrl !== 'string' || (catalogUrl && !/^https?:\/\//i.test(catalogUrl)))
        throw new Error('settings.documents.invalidPluginSources');
      return () =>
        useExtensionStore.setState((state) => ({
          catalogUrl,
          externalConfigLoaded: true,
          ...(state.catalogUrl !== catalogUrl ? { catalog: [] } : {}),
        }));
    }
  }
}

export function getImageHostRule() {
  return imageHostRule;
}

export function prepareSettingsDocumentSave(path, content) {
  const kind = settingsDocumentKind(path);
  if (!kind) return null;
  const publish = publishDocument(kind, content);
  return () => {
    if (path.startsWith('web://')) localStorage.setItem(storageKey(kind), content);
    publish();
  };
}

export function loadSettingsDocument(
  kind,
  directory = useConfigStore.getState().settingsDocumentDirectory,
) {
  const request = JSON.stringify([kind, directory]);
  if (pending.has(request)) return pending.get(request);
  const task = (async () => {
    const name = filenames[kind];
    if (!name) throw new Error('settings.documents.invalidObject');
    const seed = initialContent(kind);
    let file;
    if (window.__TAURI_INTERNALS__)
      file = await invoke('open_settings_document', { kind, seed, directory: directory || null });
    else {
      const content = localStorage.getItem(storageKey(kind)) ?? seed;
      localStorage.setItem(storageKey(kind), content);
      file = { content, path: `web://.mokidown-settings/${name}` };
      registerWebFile(file.path, null, content);
    }
    registerSettingsDocumentPath(file.path, kind);
    // Invalid files still open in the editor so their contents can be repaired.
    try {
      publishDocument(kind, file.content)();
    } catch (error) {
      console.warn('[settings]', name, error);
    }
    return { ...file, name };
  })().finally(() => pending.delete(request));
  pending.set(request, task);
  return task;
}

export function loadSettingsDocuments() {
  return Promise.allSettled(Object.keys(filenames).map(loadSettingsDocument));
}
