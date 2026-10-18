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

/**
 * Generic, collapsible sidebar panel fed by plugins. The editor has no idea
 * what the entries mean: title, labels and metadata all come from the plugin
 * that registered the source. No source → nothing renders.
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
    <section className="sidebar__plugin-panel" aria-label={source.title}>
      <header className="sidebar__plugin-panel-header">
        <button
          type="button"
          className="sidebar__plugin-panel-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className={`sidebar__plugin-panel-chevron${expanded ? ' is-open' : ''}`}><Chevron /></span>
          <span className="sidebar__plugin-panel-title">{source.title}</span>
          <span className="sidebar__plugin-panel-count">{source.items.length}</span>
        </button>
      </header>
      {expanded && (
        <ul className="sidebar__plugin-panel-list">
          {source.items.length === 0 && <li className="sidebar__plugin-panel-empty">暂无版本</li>}
          {source.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="sidebar__plugin-panel-item"
                onClick={() => sendToPlugin(source.pluginId, {
                  type: 'event',
                  name: 'versionSelected',
                  payload: { id: item.id, rev: item.rev },
                })}
              >
                <span className="sidebar__plugin-panel-label">{item.label}</span>
                {item.meta && <span className="sidebar__plugin-panel-meta">{item.meta}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
