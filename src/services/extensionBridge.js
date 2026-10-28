import i18n from '@/i18n';
import { sanitizePluginSvg } from './pluginSvg';
import { validateStatusActions } from './pluginStatusActions';
import { getPluginDocuments } from './pluginDocuments';
import { finishPluginCommand } from '@utils/pluginBus';
import { invoke } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';
import useEditorStore from '@store/useEditorStore';
import useHistoryStore from '@store/useHistoryStore';
import useVersionListStore from '@store/useVersionListStore';
import useUpdateStore from '@store/useUpdateStore';
import usePluginContributions from '@store/usePluginContributions';
import useExtensionStore from '@store/useExtensionStore';
import useThemeStore from '@store/useThemeStore';
import useNotificationStore from '@store/useNotificationStore';
import { SDK_VERSION, pluginCapabilities, publicPluginConfiguration } from '../../shared/plugin-api.mjs';
import { getBuffer, setBuffer, subscribe as subscribeBuffers } from '@utils/editorBuffer';
import { withFileOperation } from './localFileGuard';
import { getPluginDocument, applyPluginEdits, getPluginSelection, setPluginSelection } from './pluginEditor';
import { setPluginStyle, removePluginStyle, clearPluginStyles } from './pluginStyles';

export function createExtensionBridge(entry, port) {
  const { package: pkg, settings } = entry;
  let active = true;
  const pending = new Set();
  let notices = [];
  const check = () => { if (!active) throw new Error('Plugin stopped'); };
  const permit = (permission) => { check(); if (!pkg.permissions.includes(permission)) throw new Error(`PERMISSION_DENIED: ${permission}`); };
  let storage;
  let queue = Promise.resolve();
  const dispatch = async (method, args = {}) => {
    check();
    if (method === 'context') {
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(settings.workspace || ''));
      check();
      return { endpoint: settings.endpoint || '', workspace: Boolean(settings.workspace), workspaceId: Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, '0')).join(''), version: 1, apiVersion: 1, sdkVersion: SDK_VERSION, capabilities: pluginCapabilities(pkg.permissions), theme: useThemeStore.getState().theme, development: Boolean(entry.development), permissions: pkg.permissions };
    }
    if (method === 'configuration.get') return publicPluginConfiguration(pkg, settings);
    if (method === 'theme.get') return useThemeStore.getState().theme;
    if (method === 'host.reportError') {
      useExtensionStore.getState().setRuntimeError(pkg.id, String(args.message || 'Plugin activation failed').slice(0, 500));
      if (!entry.development) useExtensionStore.getState().toggle(pkg.id, false);
      return true;
    }
    if (method === 'notifications.show') {
      permit('ui.notifications');
      notices = notices.filter((time) => time > Date.now() - 10000);
      if (notices.length >= 8) throw new Error(i18n.t('pluginErrors.rateLimited'));
      notices.push(Date.now());
      const tone = ['success', 'warning', 'error', 'info'].includes(args.tone) ? args.tone : 'info';
      useNotificationStore.getState().notify(tone, pkg.name, String(args.message || '').slice(0, 500), Math.min(10000, Math.max(1500, Number(args.duration) || 4000)));
      return true;
    }
    if (method === 'command.register') {
      if (pkg.format === 'mokidown-extension-v2') permit('commands');
      if (!args.id || !/^[a-z0-9][a-z0-9.-]{1,80}$/i.test(args.id)) throw new Error('Invalid command id');
      usePluginContributions.getState().registerCommand(pkg.id, { id: args.id, title: String(args.title || args.id) });
      return true;
    }
    if (method === 'statusBar.addItem') {
      if (pkg.format === 'mokidown-extension-v2') permit('ui.statusBar');
      if (!args.id || !/^[a-z0-9][a-z0-9.-]{1,80}$/i.test(args.id)) throw new Error('Invalid status item id');
      const icon = args.icon ? sanitizePluginSvg(args.icon) : '';
      usePluginContributions.getState().addStatusBarItem(pkg.id, {
        id: args.id,
        text: String(args.text || '').slice(0, 80),
        title: String(args.title || args.text || '').slice(0, 120),
        command: args.command || null,
        icon,
        tone: ['info', 'success', 'warning', 'error'].includes(args.tone) ? args.tone : 'info',
        busy: args.busy === true,
        actions: validateStatusActions(args.actions),
        documentId: typeof args.documentId === 'string' ? args.documentId : null,
        args: args.args,
      });
      return true;
    }
    if (method === 'fileIcon.add') {
      if (pkg.format === 'mokidown-extension-v2') permit('ui.fileIcons');
      if (!args.id || !/^[a-z0-9][a-z0-9.-]{1,80}$/i.test(args.id)) throw new Error('Invalid file icon id');
      const svg = sanitizePluginSvg(args.svg);
      usePluginContributions.getState().addFileIcon(pkg.id, {
        id: args.id,
        extensions: Array.isArray(args.extensions) ? args.extensions.map((ext) => String(ext).toLowerCase()).slice(0, 32) : [],
        paths: Array.isArray(args.paths) ? args.paths.map((path) => String(path)) : [],
        svg,
      });
      return true;
    }
    if (method === 'editor.getActiveDocument') {
      if (pkg.format === 'mokidown-extension-v2') permit('editor.read');
      return getPluginDocument();
    }
    if (method === 'editor.getDocument') { permit('editor.read'); return getPluginDocument(args.documentId); }
    if (method === 'editor.getSelection') { permit('editor.read'); return getPluginSelection(args.documentId); }
    if (method === 'editor.setSelection') { permit('editor.write'); return setPluginSelection(args); }
    if (method === 'editor.focusDocument') {
      permit('editor.write');
      if (!useEditorStore.getState().tabs.some((tab) => tab.id === args.documentId)) throw new Error(i18n.t('pluginErrors.documentClosed'));
      useEditorStore.getState().setActiveTab(args.documentId);
      return true;
    }
    if (method === 'editor.listDocuments') { permit('editor.read'); return getPluginDocuments(useEditorStore.getState(), settings.workspace); }
    if (method === 'editor.reloadDocument') {
      permit('editor.write'); permit('workspace.read');
      const state = useEditorStore.getState();
      const tab = state.tabs.find((item) => item.id === args.documentId);
      const info = getPluginDocuments(state, settings.workspace).find((item) => item.id === args.documentId);
      if (!tab || !info?.relativePath || tab.modified || getBuffer(tab.id, tab.content) !== tab.content) throw new Error('Document has unsaved changes or is outside the workspace');
      const snapshot = tab.content;
      const result = await invoke('extension_workspace', { root: settings.workspace, path: info.relativePath, action: 'read', content: null, expectedHash: null }); check();
      const current = useEditorStore.getState().tabs.find((item) => item.id === tab.id);
      if (!current || current.modified || getBuffer(tab.id, current.content) !== snapshot) throw new Error('Document changed while reloading');
      if (result.content === null) { useEditorStore.getState().closeTab(tab.id); return false; }
      if (typeof result.content !== 'string') throw new Error('Document is unavailable');
      setBuffer(tab.id, result.content);
      useEditorStore.getState().replaceTabContent(tab.id, { content: result.content });
      return true;
    }
    if (method === 'editor.applyEdits') { permit('editor.write'); return applyPluginEdits(args); }
    if (method === 'styles.set') { permit('styles.markdown'); setPluginStyle(pkg.id, args.id, args.target, args.css); return true; }
    if (method === 'styles.remove') { permit('styles.markdown'); removePluginStyle(pkg.id, args.id); return true; }
    if (method === 'command.unregister') { usePluginContributions.getState().removeContribution(pkg.id, 'commands', args.id); return true; }
    if (method === 'statusBar.remove') { usePluginContributions.getState().removeContribution(pkg.id, 'statusBar', args.id); return true; }
    if (method === 'fileIcon.remove') { usePluginContributions.getState().removeContribution(pkg.id, 'fileIcons', args.id); return true; }
    if (method === 'fileBadge.add') {
      if (pkg.format === 'mokidown-extension-v2') permit('ui.fileIcons');
      if (!args.id || !/^[a-z0-9][a-z0-9.-]{1,80}$/i.test(args.id)) throw new Error('Invalid file badge id');
      const svg = sanitizePluginSvg(args.svg);
      usePluginContributions.getState().addFileBadge(pkg.id, {
        id: args.id,
        title: String(args.title || i18n.t('extensions.defaultMarker')).slice(0, 80),
        extensions: Array.isArray(args.extensions) ? args.extensions.map((ext) => String(ext).toLowerCase()).slice(0, 32) : [],
        paths: Array.isArray(args.paths) ? args.paths.map((path) => String(path)) : [],
        svg,
      });
      return true;
    }
    if (method === 'fileBadge.remove') { usePluginContributions.getState().removeFileBadge(pkg.id, args.id); return true; }
    if (method === 'task.add') {
      if (pkg.format === 'mokidown-extension-v2') permit('ui.statusBar');
      if (!args.id || !/^[a-z0-9][a-z0-9.-]{1,80}$/i.test(args.id)) throw new Error('Invalid task id');
      usePluginContributions.getState().setPluginTask(pkg.id, {
        id: args.id,
        title: String(args.title || '').slice(0, 120),
        status: String(args.status || '').slice(0, 160),
        tone: args.tone === 'warning' ? 'warning' : args.tone === 'error' ? 'error' : 'info',
        command: args.command || null,
        args: args.args || undefined,
        progress: Number.isFinite(args.progress) ? args.progress : undefined,
      });
      if (args.reveal === true) useUpdateStore.getState().showTasks();
      return true;
    }
    if (method === 'task.remove') { usePluginContributions.getState().removePluginTask(pkg.id, args.id); return true; }
    if (method === 'versions.set') {
      if (pkg.format === 'mokidown-extension-v2') permit('editor.read');
      const path = String(args.path || '').slice(0, 1024);
      if (!path) throw new Error('Invalid version source path');
      usePluginContributions.getState().setVersionSource(pkg.id, {
        path,
        title: String(args.title || i18n.t('extensions.versions')).slice(0, 80),
        emptyText: String(args.emptyText || i18n.t('history.empty')).slice(0, 120),
        items: Array.isArray(args.items) ? args.items.slice(0, 100).map((item) => ({
          id: String(item.id || '').slice(0, 160),
          label: String(item.label || '').slice(0, 160),
          meta: String(item.meta || '').slice(0, 160),
          rev: Number.isSafeInteger(item.rev) ? item.rev : null,
        })) : [],
      });
      return true;
    }
    if (method === 'versions.remove') {
      usePluginContributions.getState().removeVersionSource(pkg.id, String(args.path || ''));
      return true;
    }
    if (method === 'editor.showDiff') {
      if (pkg.format === 'mokidown-extension-v2') permit('editor.read');
      if (typeof args.content !== 'string') throw new Error('Missing remote content');
      const state = useEditorStore.getState();
      const normalize = (value) => String(value || '').replace(/\\/g, '/');
      const info = getPluginDocuments(state, settings.workspace).find((entry) => args.path
        ? normalize(entry.path) === normalize(args.path) || entry.relativePath === normalize(args.path)
        : entry.active);
      const tab = state.tabs.find((entry) => entry.id === info?.id);
      if (!tab) throw new Error('Open the document before comparing');
      useHistoryStore.getState().setDiff({
        tabId: tab.id,
        timestamp: Date.now(),
        content: String(args.content),
        label: String(args.label || ''),
        actionLabel: args.actionLabel ? String(args.actionLabel).slice(0, 80) : '',
        pluginId: pkg.id,
        actions: validateStatusActions(args.actions),
        rev: Number.isSafeInteger(args.rev) ? args.rev : null,
      });
      return true;
    }
    if (method === 'editor.showVersions') {
      if (pkg.format === 'mokidown-extension-v2') permit('editor.read');
      const state = useEditorStore.getState();
      const normalize = (value) => String(value || '').replace(/\\/g, '/');
      const info = getPluginDocuments(state, settings.workspace).find((entry) => args.path
        ? normalize(entry.path) === normalize(args.path) || entry.relativePath === normalize(args.path)
        : entry.active);
      const tab = state.tabs.find((entry) => entry.id === info?.id);
      if (!tab) throw new Error('Open the document first');
      useVersionListStore.getState().show({
        pluginId: pkg.id,
        tabId: tab.id,
        path: tab.path || String(args.path || ''),
        title: String(args.title || tab.name || ''),
        items: Array.isArray(args.items) ? args.items.slice(0, 100).map((item) => ({
          id: String(item.id || '').slice(0, 128),
          label: String(item.label || item.id || '').slice(0, 160),
          meta: String(item.meta || '').slice(0, 160),
          rev: Number.isSafeInteger(item.rev) ? item.rev : null,
          content: typeof item.content === 'string' ? item.content : null,
          actionLabel: item.actionLabel ? String(item.actionLabel).slice(0, 80) : '',
          applyIcon: item.applyIcon === 'cloud-download' ? 'cloud-download' : '',
        })) : [],
      });
      return true;
    }
    if (method === 'editor.onDidSave') {
      // The host broadcasts `didSave` to enabled plugins; nothing to store here.
      return true;
    }
    if (method.startsWith('storage.')) {
      permit('storage');
      const store = await (storage ||= load(`extension-${pkg.id}.json`)); check();
      if (method === 'storage.keys') return (await store.keys()).filter((key) => /^[a-zA-Z0-9_.-]{1,80}$/.test(key));
      if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(args.key || '')) throw new Error('Invalid storage key');
      if (method === 'storage.get') return store.get(args.key);
      if (method === 'storage.delete') { const removed = await store.delete(args.key); check(); await store.save(); return removed; }
      if (method === 'storage.set') {
        if (JSON.stringify(args.value).length > 16 * 1024 * 1024) throw new Error('Plugin storage value too large');
        await store.set(args.key, args.value); check(); await store.save(); return true;
      }
    }
    if (method === 'net.request') {
      permit('network');
      if (!settings.endpoint) throw new Error('Configure a service URL first');
      if (typeof args.path !== 'string' || !args.path.startsWith('/') || args.path.startsWith('//') || args.path.includes('\\')) throw new Error('Invalid API path');
      const base = `${settings.endpoint.replace(/\/+$/, '')}/`;
      const url = new URL(args.path.slice(1), base);
      if (!url.href.startsWith(base) || url.origin !== new URL(base).origin) throw new Error('API request escaped the configured service');
      const requestId = crypto.randomUUID(); pending.add(requestId);
      try {
        const result = await invoke('extension_http_request', { url: url.href, method: args.method || 'GET', body: args.body === undefined ? null : JSON.stringify(args.body), credentialId: pkg.id, requestId });
        check();
        if (result.status >= 300 && result.status < 400) throw new Error(i18n.t('pluginErrors.redirect', { status: result.status }));
        try { return { status: result.status, data: JSON.parse(result.body) }; }
        catch { throw new Error(i18n.t('pluginErrors.invalidResponse', { status: result.status })); }
      } finally { pending.delete(requestId); }
    }
    if (method.startsWith('fs.')) {
      const write = ['fs.write', 'fs.delete'].includes(method);
      permit(write ? 'workspace.write' : 'workspace.read');
      if (!settings.workspace) throw new Error('Choose a workspace first');
      const path = String(args.path || '');
      if (path && (path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => !part || part === '.' || part === '..' || part.includes(':')))) throw new Error('Invalid relative path');
      if (method !== 'fs.list' && !pkg.fileExtensions?.some((ext) => path.toLowerCase().endsWith(`.${ext}`))) throw new Error('File type is outside plugin permissions');
      const absolute = `${settings.workspace.replace(/[\\/]+$/, '')}/${path}`;
      const operation = async () => {
        check();
        if (write) {
          const tab = useEditorStore.getState().tabs.find((tab) => tab.path?.replace(/\\/g, '/') === absolute.replace(/\\/g, '/'));
          if (tab && (tab.modified || getBuffer(tab.id, tab.content) !== tab.content)) throw new Error('File has unsaved editor changes');
        }
        const result = await invoke('extension_workspace', { root: settings.workspace, path, action: method.slice(3), content: args.content ?? null, expectedHash: args.expectedHash ?? null });
        check(); return result;
      };
      return write ? withFileOperation(absolute, operation) : operation();
    }
    throw new Error(`Unknown plugin method: ${method}`);
  };
  port.onmessage = ({ data }) => {
    if (active && data?.type === 'command-result') { finishPluginCommand(pkg.id, data); return; }
    if (!active || !Number.isSafeInteger(data?.id)) return;
    // Serialize plugin requests to preserve storage/write ordering on shutdown.
    queue = queue.then(async () => {
      try { const value = await dispatch(data.method, data.args); if (active) port.postMessage({ id: data.id, value }); }
      catch (error) { if (active) port.postMessage({ id: data.id, error: String(error?.message || error), code: /^([A-Z][A-Z_]+):/.exec(error?.message)?.[1] || 'PLUGIN_ERROR' }); }
    });
  };
  port.start();
  let documentKey = '';
  const documentsChanged = (state) => {
    if (!active || !pkg.permissions.includes('editor.read')) return;
    const documents = getPluginDocuments(state, settings.workspace);
    const key = JSON.stringify(documents);
    if (key === documentKey) return;
    documentKey = key;
    port.postMessage({ type: 'event', name: 'documentsChanged', payload: documents });
  };
  const unsubscribeDocuments = useEditorStore.subscribe(documentsChanged);
  let contentTimer;
  const changedDocuments = new Set();
  const unsubscribeBuffers = pkg.permissions.includes('editor.read') ? subscribeBuffers((ids) => {
    for (const id of ids) if (useEditorStore.getState().tabs.some((tab) => tab.id === id)) changedDocuments.add(id);
    clearTimeout(contentTimer);
    contentTimer = setTimeout(() => {
      if (active && changedDocuments.size) port.postMessage({ type: 'event', name: 'documentContentChanged', payload: { documentIds: [...changedDocuments] } });
      changedDocuments.clear();
    }, 120);
  }) : null;
  let previousTheme = useThemeStore.getState().theme;
  const unsubscribeTheme = useThemeStore.subscribe((state) => {
    if (!active || state.theme === previousTheme) return;
    previousTheme = state.theme;
    port.postMessage({ type: 'event', name: 'themeChanged', payload: state.theme });
  });
  documentsChanged(useEditorStore.getState());
  const dispose = () => {
    active = false;
    unsubscribeDocuments();
    unsubscribeBuffers?.();
    clearTimeout(contentTimer);
    unsubscribeTheme();
    clearPluginStyles(pkg.id);
    port.close();
    for (const requestId of pending) void invoke('extension_cancel_request', { requestId }).catch(() => {});
  };
  const send = (message) => {
    if (active) port.postMessage(message);
  };
  return { dispose, send };
}
