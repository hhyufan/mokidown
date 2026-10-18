import { Modal } from 'antd';
import useVersionListStore from '@store/useVersionListStore';
import useHistoryStore from '@store/useHistoryStore';
import { sendToPlugin } from '@utils/pluginBus';

/**
 * Renders the version list a plugin asked for. Clicking an entry with content
 * opens the same diff view the editor uses for history; the plugin also gets
 * a `versionSelected` event so it can react on its own.
 */
export default function VersionList() {
  const state = useVersionListStore();
  if (!state.open) return null;
  const pick = (item) => {
    sendToPlugin(state.pluginId, {
      type: 'event',
      name: 'versionSelected',
      payload: { id: item.id, rev: item.rev },
    });
    if (item.content != null && state.tabId) {
      useHistoryStore.getState().setDiff({
        tabId: state.tabId,
        timestamp: Date.now(),
        content: item.content,
        label: item.label || state.title,
        actionLabel: item.actionLabel || '',
        applyIcon: item.applyIcon || '',
      });
    }
    state.close();
  };
  return (
    <Modal open title={state.title} footer={null} onCancel={state.close} width={520}>
      <div className="version-list">
        {state.items.length === 0 && <p className="version-list__empty">暂无版本</p>}
        {state.items.map((item) => (
          <button key={item.id} type="button" className="version-list__item" onClick={() => pick(item)}>
            <span className="version-list__label">{item.label || item.id}</span>
            {item.meta && <span className="version-list__meta">{item.meta}</span>}
          </button>
        ))}
      </div>
    </Modal>
  );
}
