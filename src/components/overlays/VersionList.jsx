import { useTranslation } from 'react-i18next';
import { Modal } from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import { formatHistoryTime, formatHistoryBytes } from '@utils/historyFormat';
import useVersionListStore from '@store/useVersionListStore';
import useHistoryStore from '@store/useHistoryStore';
import { sendToPlugin } from '@utils/pluginBus';

/**
 * Renders the version list a plugin asked for. Clicking an entry with content
 * opens the same diff view the editor uses for history; the plugin also gets
 * a `versionSelected` event so it can react on its own.
 */
export default function VersionList() {
  const { t } = useTranslation();
  const state = useVersionListStore();
  if (!state.open) return null;
  const pick = (item) => {
    sendToPlugin(state.pluginId, {
      type: 'event',
      name: 'versionSelected',
      payload: { id: item.id, rev: item.rev, timestamp: item.timestamp },
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
        {state.items.length === 0 && (
          <p className="version-list__empty">{t('extensions.noVersions')}</p>
        )}
        {state.items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="version-list__item"
            onClick={() => pick(item)}
          >
            {item.restored && (
              <span
                className="version-list__rollback"
                role="img"
                aria-label={t('history.rollback')}
              >
                <HistoryOutlined aria-hidden="true" />
              </span>
            )}
            <span className="version-list__label">
              {Number.isFinite(item.timestamp)
                ? formatHistoryTime(item.timestamp)
                : item.label || item.id}
            </span>
            {(item.bytes != null || item.meta) && (
              <span className="version-list__meta">
                {item.bytes != null ? formatHistoryBytes(item.bytes) : item.meta}
              </span>
            )}
          </button>
        ))}
      </div>
    </Modal>
  );
}
