import { useState } from 'react';
import useEditorStore from '@store/useEditorStore';
import usePluginContributions from '@store/usePluginContributions';
import { sendToPlugin } from '@utils/pluginBus';

const normalize = (value) => String(value || '').replace(/\\/g, '/');

const Chevron = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="m6 3 5 5-5 5" />
  </svg>
);

const Refresh = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M13.2 8a5.2 5.2 0 1 1-1.5-3.7" />
    <path d="M13.5 2.5v3h-3" />
  </svg>
);

/**
 * Generic, collapsible sidebar panel fed by plugins. It mirrors the local
 * history row (same typography and expand/collapse) while title, entries and
 * the refresh action all come from the plugin.
 */
export default function PluginPanel() {
  const [expanded, setExpanded] = useState(false);
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const sources = usePluginContributions((s) => s.versionSources);
  const tab = tabs.find((item) => item.id === activeTabId) || null;
  const source = sources.find((entry) => tab?.path
    && (normalize(tab.path) === normalize(entry.path) || normalize(tab.path).endsWith('/' + normalize(entry.path))));
  if (!source) return null;
  return (
    <section className="plugin-panel" aria-label={source.title}>
      <header className="plugin-panel__header">
        <button
          type="button"
          className="plugin-panel__toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className={`plugin-panel__chevron${expanded ? ' is-open' : ''}`}><Chevron /></span>
          <span className="plugin-panel__title">{source.title}</span>
          <span className="plugin-panel__count">{source.items.length}</span>
        </button>
        <button
          type="button"
          className="plugin-panel__refresh"
          aria-label="刷新"
          onClick={() => sendToPlugin(source.pluginId, { type: 'event', name: 'versionRefresh' })}
        >
          <Refresh />
        </button>
      </header>
      {expanded && (
        <ul className="plugin-panel__list">
          {source.items.length === 0 && <li className="plugin-panel__empty">暂无历史</li>}
          {source.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="plugin-panel__item"
                onClick={() => sendToPlugin(source.pluginId, {
                  type: 'event',
                  name: 'versionSelected',
                  payload: { id: item.id, rev: item.rev },
                })}
              >
                <span className="plugin-panel__label">{item.label}</span>
                {item.meta && <span className="plugin-panel__meta">{item.meta}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
