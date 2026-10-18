import { sanitizePluginSvg } from './pluginSvg';
import { validateStatusActions } from './pluginStatusActions';
import { invoke } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';
import useEditorStore from '@store/useEditorStore';
import useHistoryStore from '@store/useHistoryStore';
import useUpdateStore from '@store/useUpdateStore';
import usePluginContributions from '@store/usePluginContributions';
import { getBuffer } from '@utils/editorBuffer';
import { withFileOperation } from './localFileGuard';
import { getPluginDocument, applyPluginEdits } from './pluginEditor';
import { setPluginStyle, removePluginStyle, clearPluginStyles } from './pluginStyles';

export function createExtensionBridge(entry, port) {
  const { package: pkg, settings } = entry;
  let active = true;
  const pending = new Set();
  const check = () => { if (!active) throw new Error('Plugin stopped'); };
  const permit = (permission) => { check(); if (!pkg.permissions.includes(permission)) throw new Error(`Permission required: ${permission}`); };
  let storage;
  let queue = Promise.resolve();
  const dispatch = async (method, args = {}) => {
    check();
    if (method === 'context') {
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(settings.workspace || ''));
      check();
      return { endpoint: settings.endpoint || '', workspace: Boolean(settings.workspace), workspaceId: Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, '0')).join(''), version: 1, apiVersion: 1, permissions: pkg.permissions };
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
    if (method === 'editor.applyEdits') { permit('editor.write'); return applyPluginEdits(args); }
    if (method === 'styles.set') { permit('styles.markdown'); setPluginStyle(pkg.id, args.id, args.target, args.css); return true; }
    if (method === 'styles.remove') { permit('styles.markdown'); removePluginStyle(pkg.id, args.id); return true; }
    if (method === 'command.unregister') { usePluginContributions.getState().removeContribution(pkg.id, 'commands', args.id); return true; }
    if (method === 'statusBar.remove') { usePluginContributions.getState().removeContribution(pkg.id, 'statusBar', args.id); return true; }
    if (method === 'fileIcon.remove') { usePluginContributions.getState().removeContribution(pkg.id, 'fileIcons', args.id); return true; }
    if (method === 'fileBadge.add') {
      if (!args.id || !/^[a-z0-9][a-z0-9.-]{1,80}$/i.test(args.id)) throw new Error('Invalid file badge id');
      const svg = String(args.svg || '');
      if (svg.length > 4096 || !/^<svg[\s>]/i.test(svg.trim()) || /<script|onload=|onclick=/i.test(svg)) throw new Error('Invalid SVG badge');
      usePluginContributions.getState().addFileBadge(pkg.id, {
        id: args.id,
        title: String(args.title || '云端').slice(0, 80),
        extensions: Array.isArray(args.extensions) ? args.extensions.map((ext) => String(ext).toLowerCase()).slice(0, 32) : [],
        paths: Array.isArray(args.paths) ? args.paths.map((path) => String(path)) : [],
        svg,
      });
      return true;
    }
    if (method === 'fileBadge.remove') { usePluginContributions.getState().removeFileBadge(pkg.id, args.id); return true; }
    if (method === 'task.add') {
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
      useUpdateStore.getState().showTasks();
      return true;
    }
    if (method === 'task.remove') { usePluginContributions.getState().removePluginTask(pkg.id, args.id); return true; }
    if (method === 'editor.showDiff') {
      if (typeof args.content !== 'string') throw new Error('Missing remote content');
      const state = useEditorStore.getState();
      const normalize = (value) => String(value || '').replace(/\\/g, '/');
      const matches = (left, right) => left === right || left.endsWith('/' + right) || right.endsWith('/' + left);
      const tab = state.tabs.find((entry) => entry.id === state.activeTabId && (!args.path || matches(normalize(entry.path), normalize(args.path))))
        || state.tabs.find((entry) => args.path && matches(normalize(entry.path), normalize(args.path)));
      if (!tab) throw new Error('Open the document before comparing');
      useHistoryStore.getState().setDiff({
        tabId: tab.id,
        timestamp: Date.now(),
        content: String(args.content),
        label: String(args.label || ''),
        actionLabel: args.actionLabel ? String(args.actionLabel).slice(0, 80) : '',
        applyIcon: args.applyIcon === 'cloud-download' ? 'cloud-download' : '',
        rev: Number.isSafeInteger(args.rev) ? args.rev : null,
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
      if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(args.key || '')) throw new Error('Invalid storage key');
      if (method === 'storage.get') return store.get(args.key);
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
        if (result.status >= 300 && result.status < 400) throw new Error(`SERVICE_REDIRECT: 服务返回 HTTP ${result.status} 跳转，请填写最终的 API 地址。`);
        try { return { status: result.status, data: JSON.parse(result.body) }; }
        catch { throw new Error(`SERVICE_INVALID_RESPONSE: 服务返回 HTTP ${result.status} 非 JSON 响应，请检查 API 路径、反代或隧道状态。`); }
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
    if (!active || !Number.isSafeInteger(data?.id)) return;
    // Serialize plugin requests to preserve storage/write ordering on shutdown.
    queue = queue.then(async () => {
      try { const value = await dispatch(data.method, data.args); if (active) port.postMessage({ id: data.id, value }); }
      catch (error) { if (active) port.postMessage({ id: data.id, error: String(error?.message || error) }); }
    });
  };
  port.start();
  const dispose = () => {
    active = false;
    clearPluginStyles(pkg.id);
    port.close();
    for (const requestId of pending) void invoke('extension_cancel_request', { requestId }).catch(() => {});
  };
  const send = (message) => {
    if (active) port.postMessage(message);
  };
  return { dispose, send };
}
