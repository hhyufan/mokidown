export const SDK_VERSION = '1.3.0';
export class PluginError extends Error {
  constructor(message, code = 'PLUGIN_ERROR') { super(message); this.name = 'PluginError'; this.code = code; }
}

export function createPluginClient(port, { timeoutMs = 35000 } = {}) {
  let nextId = 0, disposed = false;
  const pending = new Map(), commands = new Map(), listeners = new Map(), cleanup = [];
  const controller = new AbortController();
  const rpc = (method, args = {}) => {
    if (disposed) return Promise.reject(new PluginError('Plugin stopped', 'PLUGIN_STOPPED'));
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(new PluginError(`Plugin request timed out: ${method}`, 'RPC_TIMEOUT')); }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try { port.postMessage({ id, method, args }); }
      catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
    });
  };
  const report = (error) => { console.error('[MokiDown plugin]', error); };
  const handle = ({ data }) => {
    if (disposed) return;
    if (data?.type === 'command') {
      const callback = commands.get(data.id);
      const result = callback ? Promise.resolve().then(() => callback(data.args)) : Promise.reject(new PluginError('Unknown plugin command'));
      result.then((value) => { if (data.requestId && !disposed) port.postMessage({ type: 'command-result', requestId: data.requestId, value }); })
        .catch((error) => { if (data.requestId && !disposed) port.postMessage({ type: 'command-result', requestId: data.requestId, error: error.message }); else report(error); });
      return;
    }
    if (data?.type === 'event') {
      for (const callback of listeners.get(data.name) || []) Promise.resolve().then(() => callback(data.payload)).catch(report);
      return;
    }
    const request = pending.get(data?.id); if (!request) return;
    pending.delete(data.id); clearTimeout(request.timer);
    if (data.error) request.reject(new PluginError(typeof data.error === 'string' ? data.error : data.error.message, data.code || data.error.code));
    else request.resolve(data.value);
  };
  port.addEventListener('message', handle); port.start();
  const on = (name, callback) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(callback);
    return () => listeners.get(name)?.delete(callback);
  };
  const api = {
    apiVersion: 1, sdkVersion: SDK_VERSION, rpc, signal: controller.signal,
    context: () => rpc('context'),
    capabilities: { get: async () => (await rpc('context')).capabilities || [], has: async (name) => ((await rpc('context')).capabilities || []).includes(name) },
    configuration: { get: () => rpc('configuration.get') },
    theme: { get: () => rpc('theme.get'), onDidChange: (callback) => on('themeChanged', callback) },
    notifications: { show: (message, options = {}) => rpc('notifications.show', { ...options, message }) },
    storage: { get: (key) => rpc('storage.get', { key }), set: (key, value) => rpc('storage.set', { key, value }), keys: () => rpc('storage.keys'), delete: (key) => rpc('storage.delete', { key }) },
    workspace: {
      list: (path = '') => rpc('fs.list', { path }), read: (path) => rpc('fs.read', { path }),
      write: (path, content, expectedHash = null) => rpc('fs.write', { path, content, expectedHash }),
      delete: (path, expectedHash) => rpc('fs.delete', { path, expectedHash }),
    },
    net: { request: (path, options = {}) => rpc('net.request', { path, ...options }) },
    commands: { register: async (id, title, callback) => {
      const previous = commands.get(id); commands.set(id, callback);
      try { await rpc('command.register', { id, title }); }
      catch (error) { if (commands.get(id) === callback) { if (previous) commands.set(id, previous); else commands.delete(id); } throw error; }
      return () => { if (commands.get(id) !== callback) return; commands.delete(id); if (!disposed) void rpc('command.unregister', { id }).catch(report); };
    } },
    statusBar: { set: (id, item) => rpc('statusBar.addItem', { id, ...item }), remove: (id) => rpc('statusBar.remove', { id }) },
    fileIcons: { set: (id, item) => rpc('fileIcon.add', { id, ...item }), remove: (id) => rpc('fileIcon.remove', { id }) },
    fileBadges: { set: (id, item) => rpc('fileBadge.add', { id, ...item }), remove: (id) => rpc('fileBadge.remove', { id }) },
    tasks: { set: (id, task) => rpc('task.add', { id, ...task }), remove: (id) => rpc('task.remove', { id }) },
    versions: { set: (source) => rpc('versions.set', source), remove: (path) => rpc('versions.remove', { path }), onDidSelect: (callback) => on('versionSelected', callback), onDidRequestRefresh: (callback) => on('versionRefresh', callback) },
    editor: {
      getActiveDocument: () => rpc('editor.getActiveDocument'), getDocument: (documentId) => rpc('editor.getDocument', { documentId }),
      listDocuments: () => rpc('editor.listDocuments'), focusDocument: (documentId) => rpc('editor.focusDocument', { documentId }),
      getSelection: (documentId) => rpc('editor.getSelection', { documentId }),
      setSelection: (documentId, expectedChecksum, from, to = from) => rpc('editor.setSelection', { documentId, expectedChecksum, from, to }),
      showDiff: (options) => rpc('editor.showDiff', options), showVersions: (options) => rpc('editor.showVersions', options),
      reloadDocument: (documentId) => rpc('editor.reloadDocument', { documentId }),
      applyEdits: (documentId, expectedChecksum, edits) => rpc('editor.applyEdits', { documentId, expectedChecksum, edits }),
      onDidSave: (callback) => on('didSave', callback), onDidChangeDocuments: (callback) => on('documentsChanged', callback), onDidChangeContent: (callback) => on('documentContentChanged', callback),
    },
    styles: { setMarkdown: (id, css) => rpc('styles.set', { id, target: 'markdown', css }), remove: (id) => rpc('styles.remove', { id }) },
    on, onDispose: (callback) => { if (disposed) callback(); else cleanup.push(callback); return callback; },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      controller.abort();
      for (const callback of cleanup.reverse()) { try { callback(); } catch (error) { report(error); } }
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new PluginError('Plugin stopped', 'PLUGIN_STOPPED')); }
      pending.clear(); commands.clear(); listeners.clear(); port.removeEventListener('message', handle); port.close();
    },
  };
  return api;
}

export function definePlugin(activate) {
  let client;
  const attach = (event) => {
    if (client || event.source !== parent || event.data?.type !== 'mokidown:extension-port' || !event.ports[0]) return;
    client = createPluginClient(event.ports[0]);
    Promise.resolve().then(() => activate(client)).then((dispose) => { if (typeof dispose === 'function') client.onDispose(dispose); }).catch((error) => {
      console.error('[MokiDown plugin activation]', error);
      void client.rpc('host.reportError', { message: error.message }).catch(() => {}).finally(() => client.dispose());
    });
  };
  window.addEventListener('message', attach);
  window.addEventListener('pagehide', () => { window.removeEventListener('message', attach); client?.dispose(); }, { once: true });
  parent.postMessage({ type: 'mokidown:extension-ready' }, '*');
}
