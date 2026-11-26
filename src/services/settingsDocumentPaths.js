const managedPaths = new Map();

const pathKey = (path) => {
  const result = String(path || '').replaceAll('\\', '/');
  return /^(?:[a-z]:|\/\/)/i.test(result) ? result.toLowerCase() : result;
};

const filenames = {
  'image-host.jsonc': 'imageHost',
  'language-plugins.jsonc': 'languagePlugins',
  'service-plugin-sources.jsonc': 'servicePlugins',
  'local-settings.jsonc': 'localSettings',
};

const kindFromPath = (path) => {
  const normalized = String(path || '')
    .replaceAll('\\', '/')
    .toLowerCase();
  if (!/(^|\/)editor-settings\//.test(normalized)) return undefined;
  return filenames[normalized.split('/').pop()];
};

export const registerSettingsDocumentPath = (path, kind) => managedPaths.set(pathKey(path), kind);
export const settingsDocumentKind = (path) => managedPaths.get(pathKey(path)) || kindFromPath(path);
