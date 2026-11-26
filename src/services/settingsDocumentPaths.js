const managedPaths = new Map();

const pathKey = (path) => {
  const result = String(path || '').replaceAll('\\', '/');
  return /^(?:[a-z]:|\/\/)/i.test(result) ? result.toLowerCase() : result;
};

export const registerSettingsDocumentPath = (path, kind) => managedPaths.set(pathKey(path), kind);
export const settingsDocumentKind = (path) => managedPaths.get(pathKey(path));
