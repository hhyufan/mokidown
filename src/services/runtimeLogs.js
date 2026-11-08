import { create } from 'zustand';
import { invoke as nativeInvoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import i18n from '@/i18n';
import useNotificationStore from '@store/useNotificationStore';

const limit = 200;
const repeatWindow = 5000;
let sequence = 0;
let lastNotification = -Infinity;

export const useRuntimeLogStore = create((set) => ({
  entries: [],
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  clear: () => set({ entries: [] }),
}));

/** Export the current runtime error entries as a JSON report. */
export async function exportRuntimeLogs(entries) {
  const name = `mokidown-errors-${new Date().toISOString().slice(0, 10)}.json`;
  const data = JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), entries }, null, 2);
  if (window.__TAURI_INTERNALS__) {
    const path = await save({ defaultPath: name, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!path) return false;
    await writeTextFile(path, data);
  } else {
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return true;
}

function clean(value, length) {
  return String(value || '').slice(0, length)
    .replace(/\b(Bearer\s+)[^\s,;"']+/gi, '$1[redacted]')
    .replace(/([?&](?:access_token|refresh_token|token|api[_-]?key|password)=)[^&#\s]+/gi, '$1[redacted]');
}

function isCancellation(value) {
  return /^(?:Canceled|CancellationError|AbortError)$/.test(value?.name || '') ||
    /^(?:canceled|cancelled|aborted)$/i.test(value?.message || value || '');
}

export function reportRuntimeLog({ level = 'error', source = 'WebView', message, stack, detail, timestamp = Date.now(), announce = true }) {
  if (!message || isCancellation(message)) return;
  const entry = {
    id: ++sequence, level, source, timestamp,
    message: clean(message, 4096), stack: clean(stack, 10000), detail: clean(detail, 1024), count: 1,
  };
  useRuntimeLogStore.setState(({ entries }) => {
    const index = entries.findIndex((item) => item.message === entry.message && item.level === entry.level &&
      Math.abs(entry.timestamp - item.timestamp) <= repeatWindow);
    if (index < 0) return { entries: [entry, ...entries].slice(0, limit) };
    const previous = entries[index];
    return { entries: [{ ...previous, ...entry, id: previous.id, stack: entry.stack || previous.stack,
      detail: entry.detail || previous.detail, count: previous.count + 1 }, ...entries.filter((_, i) => i !== index)] };
  });
  const now = Date.now();
  if (announce && level === 'error' && now - lastNotification >= repeatWindow) {
    lastNotification = now;
    useNotificationStore.getState().notify('error', i18n.t('runtimeLogs.reported'), '', 6000, {
      label: i18n.t('runtimeLogs.view'),
      run: useRuntimeLogStore.getState().show,
    });
  }
}

export function reportReactError(error, info) {
  if (isCancellation(error)) return;
  reportRuntimeLog({
    source: 'React', message: error?.message || String(error), stack: error?.stack,
    detail: info?.componentStack,
  });
}

export function reportTauriFailure(command, reason, args) {
  if (isCancellation(reason)) return;
  const message = typeof reason === 'string' ? reason : reason?.message || 'Tauri command failed';
  // A vanished file is an expected business state: callers surface it as a
  // missing/blocked tab. Logging every autosave/switch attempt only floods the
  // panel, and the old entry had no path to locate the file anyway.
  if (command === 'read_file_content' && /os error (?:2|3)\b|not found|No such file/i.test(message)) return;
  const filePath = args?.filePath || args?.path;
  reportRuntimeLog({
    source: 'Tauri', detail: filePath ? `${command} ${filePath}` : command, announce: false,
    level: ['missing', 'binary', 'not-file', 'too-large'].includes(reason?.kind) ? 'warning' : 'error',
    message,
    stack: reason?.stack,
  });
}

export function installRuntimeLogging() {
  const bootstrap = window.__mokiRuntimeLogs;
  if (bootstrap) {
    bootstrap.accept = reportRuntimeLog;
    bootstrap.pending.forEach(reportRuntimeLog);
  }
  const original = { warn: console.warn, error: console.error };
  const wrapped = {};
  for (const method of ['warn', 'error']) {
    wrapped[method] = (...args) => {
      original[method].apply(console, args);
      const error = args.find((arg) => arg instanceof Error);
      const strings = args.filter((arg) => typeof arg === 'string');
      if (isCancellation(error) || /^The above error occurred in the /.test(strings[0])) return;
      const message = error?.message || strings.join(' ');
      // Dev HMR reloads leave Tauri's async callbacks orphaned; that is a
      // tooling artifact, not an app error. Vue flags are injected at build time.
      if (/Couldn't find callback id/.test(message) || /__VUE_(?:OPTIONS_API|PROD_DEVTOOLS|PROD_HYDRATION_MISMATCH_DETAILS)__/.test(message)) return;
      reportRuntimeLog({
        source: /^Warning: /.test(strings[0]) ? 'React' : 'WebView',
        level: method === 'warn' || /^Warning: /.test(strings[0]) ? 'warning' : 'error',
        message, stack: error?.stack, detail: error ? strings.join(' ') : '',
      });
    };
    console[method] = wrapped[method];
  }
  return () => {
    if (bootstrap?.accept === reportRuntimeLog) bootstrap.accept = null;
    for (const method of ['warn', 'error']) {
      if (console[method] === wrapped[method]) console[method] = original[method];
    }
  };
}

export function startNativeLogPolling() {
  if (!window.__TAURI_INTERNALS__) return;
  let cursor = 0;
  let disposed = false;
  let busy = false;
  let timer;
  const poll = async () => {
    if (disposed || busy) return;
    busy = true;
    try {
      if (!document.hidden) {
        const entries = await nativeInvoke('read_runtime_logs', { after: cursor });
        if (disposed || !Array.isArray(entries)) return;
        for (const entry of entries) {
          cursor = Math.max(cursor, entry.id);
          // Updater checks run at startup; an unreachable mirror or offline
          // network is expected and must not flood the error panel.
          if (/failed to check for updates/i.test(entry.message || '')) continue;
          reportRuntimeLog({ ...entry, source: 'Tauri', detail: entry.target });
        }
      }
      if (!disposed) timer = setTimeout(poll, 2500);
    } catch {
      // An older native binary has no log reader. JS logging still works.
    } finally {
      busy = false;
    }
  };
  void poll();
  return () => {
    disposed = true;
    clearTimeout(timer);
  };
}
