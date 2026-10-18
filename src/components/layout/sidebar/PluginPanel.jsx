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
 * Generic, collapsible sidebar panel fed by plugins. It reuses the local
 * history row styling so both panels look identical; the editor still has no
 * idea what the entries mean — title and items come from the plugin.
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
    <section className="timeline sidebar__plugin-panel" aria-label={source.title}>
      <header className="timeline__header">
        <button
          type="button"
          className="timeline__toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className={`timeline__chevron sidebar__plugin-panel-chevron${expanded ? ' is-open' : ''}`}><Chevron /></span>
          <span className="timeline__label">{source.title}</span>
          <span className="timeline__count">{source.items.length}</span>
        </button>
      </header>
      {expanded && (
        <div className="timeline__body">
          <ul className="timeline__list">
            {source.items.length === 0 && <li className="sidebar__plugin-panel-empty">暂无版本</li>}
            {source.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="timeline__item"
                  onClick={() => sendToPlugin(source.pluginId, {
                    type: 'event',
                    name: 'versionSelected',
                    payload: { id: item.id, rev: item.rev },
                  })}
                >
                  <span className="timeline__time">{item.label}</span>
                  <span className="timeline__size">{item.meta}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
