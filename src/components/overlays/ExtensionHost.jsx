import { useEffect, useRef } from 'react';
import useExtensionStore from '@store/useExtensionStore';
import usePluginContributions from '@store/usePluginContributions';
import useHistoryStore from '@store/useHistoryStore';
import { createExtensionBridge } from '@/services/extensionBridge';
import { registerPluginSender, unregisterPluginSender } from '@utils/pluginBus';
import './service-extensions.scss';
import { setPluginStyle, clearPluginStyles } from '@/services/pluginStyles';

function ExtensionFrame({ entry }) {
  const ref = useRef(null);
  useEffect(() => {
    const frame = ref.current;
    try {
      for (const style of entry.package.bundledStyles || []) setPluginStyle(entry.package.id, style.id, style.target, style.css);
      useExtensionStore.getState().setRuntimeError(entry.package.id, '');
    } catch (error) {
      clearPluginStyles(entry.package.id);
      useExtensionStore.getState().setRuntimeError(entry.package.id, error.message);
      return () => clearPluginStyles(entry.package.id);
    }
    // Each enabled plugin has a disposable, opaque-origin JavaScript realm.
    const runner = new URL('extension-runner.js', document.baseURI);
    const runnerSource = runner.origin === 'null' ? runner.protocol : runner.origin;
    const channel = new MessageChannel();
    const bridge = createExtensionBridge(entry, channel.port1);
    registerPluginSender(entry.package.id, bridge.send);
    let attached = false;
    const attach = (event) => {
      if (event.source !== frame.contentWindow) return;
      if (event.data?.type === 'mokidown:extension-runner-ready') {
        frame.contentWindow.postMessage({ type: 'mokidown:extension-bootstrap', script: entry.package.script }, '*');
        return;
      }
      if (attached || event.data?.type !== 'mokidown:extension-ready') return;
      attached = true;
      frame.contentWindow.postMessage({ type: 'mokidown:extension-port' }, '*', [channel.port2]);
    };
    window.addEventListener('message', attach);
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${runnerSource} blob:; style-src 'unsafe-inline'; connect-src 'none'; img-src data:;"><script defer src="${runner.href}"></script></head><body></body></html>`;
    return () => { unregisterPluginSender(entry.package.id); usePluginContributions.getState().clearPlugin(entry.package.id); if (useHistoryStore.getState().diff?.pluginId === entry.package.id) useHistoryStore.getState().clearDiff(); clearPluginStyles(entry.package.id); bridge.dispose(); window.removeEventListener('message', attach); frame.srcdoc = ''; };
  }, [entry]);
  return <iframe ref={ref} hidden aria-hidden="true" tabIndex={-1} title={entry.package.name} sandbox="allow-scripts" />;
}

export default function ExtensionHost() {
  const installed = useExtensionStore((state) => state.installed);
  return installed.filter((entry) => entry.enabled).map((entry) => <ExtensionFrame key={entry.package.id} entry={entry} />);
}
