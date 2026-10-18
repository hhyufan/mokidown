import { useState } from 'react';
import { ReloadOutlined } from '@ant-design/icons';
import ChevronIcon from '@components/ui/ChevronIcon';
import useEditorStore from '@store/useEditorStore';
import usePluginContributions from '@store/usePluginContributions';
import { sendToPlugin } from '@utils/pluginBus';
import '@components/history/history.scss';

const normalize = (value) => String(value || '').replace(/\\/g, '/');

/**
 * Generic, collapsible sidebar panel fed by plugins. It copies the exact
 * timeline structure (including the `timeline--open` class that drives the
 * height transition and chevron rotation) so it looks and behaves identically
 * to local history; title and entries come from the plugin.
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
    <section className={`timeline${expanded ? ' timeline--open' : ''}`} aria-label={source.title}>
      <header className="timeline__header">
        <button
          type="button"
          className="timeline__toggle"
          aria-expanded={expanded}
          aria-label={source.title}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronIcon className="timeline__chevron" />
        </button>
        <span className="timeline__label">{source.title}</span>
        <span className="timeline__count">{source.items.length}</span>
        <button
          type="button"
          className="timeline__refresh"
          aria-label="刷新"
          onClick={() => sendToPlugin(source.pluginId, { type: 'event', name: 'versionRefresh' })}
        >
          <ReloadOutlined />
        </button>
      </header>
      <div className="timeline__body" aria-hidden={!expanded}>
        <ul className="timeline__list">
          {source.items.length === 0 && <li className="timeline__placeholder">暂无历史</li>}
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
    </section>
  );
}
