import { useEffect, useState } from 'react';
import { Button, Select } from 'antd';
import { useTranslation } from 'react-i18next';
import useNotificationStore from '@store/useNotificationStore';
import { exportRuntimeLogs, startNativeLogPolling, startRuntimeLogSync, useRuntimeLogStore } from '@/services/runtimeLogs';
import NotificationContainer from '@components/notification/NotificationContainer';
import ChevronIcon from '@components/ui/ChevronIcon';
import AppDialog from './AppDialog';
import './runtime-logs.scss';

async function exportLogs(entries) {
  return exportRuntimeLogs(entries);
}

function RuntimeLogDialog({ onClose }) {
  const { t } = useTranslation();
  const entries = useRuntimeLogStore((state) => state.entries);
  const clear = useRuntimeLogStore((state) => state.clear);
  const [level, setLevel] = useState('all');
  const [exporting, setExporting] = useState(false);
  const visible = level === 'all' ? entries : entries.filter((entry) => entry.level === level);

  const handleExport = async () => {
    setExporting(true);
    try {
      if (await exportLogs(visible)) {
        useNotificationStore.getState().notify('success', t('runtimeLogs.exported'));
        clear();
        onClose();
      }
    } catch (error) {
      useNotificationStore.getState().notify('error', t('runtimeLogs.exportFailed'), String(error?.message || error));
    } finally {
      setExporting(false);
    }
  };

  const handleDiscard = () => {
    clear();
    onClose();
  };

  return (
    <AppDialog open onCancel={onClose} title={t('runtimeLogs.title')} width={760}
      footer={[
        <Button key="discard" danger onClick={handleDiscard}>{t('runtimeLogs.discard')}</Button>,
        <Button key="export" type="primary" onClick={handleExport} disabled={!visible.length} loading={exporting}>
          {t('runtimeLogs.accept')}
        </Button>,
      ]}>
      <div className="runtime-logs__toolbar">
        <Select value={level} onChange={setLevel} aria-label={t('runtimeLogs.filter')} virtual={false}
          options={['all', 'error', 'warning'].map((value) => ({ value, label: t(`runtimeLogs.${value}`) }))} />
        <p>{t('runtimeLogs.privacy')}</p>
      </div>
      <div className="runtime-logs__entries">
        {!visible.length && <p>{t('runtimeLogs.empty')}</p>}
        {visible.map((entry) => (
          <details key={entry.id} className="runtime-logs__entry">
            <summary>
              <ChevronIcon className="runtime-logs__chevron" />
              <span className={`runtime-logs__${entry.level}`}>{t(`runtimeLogs.${entry.level}`)}</span>
              {' · '}{entry.source}{' · '}
              <time dateTime={new Date(entry.timestamp).toISOString()}>{new Date(entry.timestamp).toLocaleTimeString()}</time>
              {entry.count > 1 && ` · ×${entry.count}`}
              <span className="runtime-logs__message">{entry.message}</span>
            </summary>
            <pre>{[entry.message, entry.detail, entry.stack].filter(Boolean).join('\n\n')}</pre>
          </details>
        ))}
      </div>
    </AppDialog>
  );
}

export default function RuntimeLogHost() {
  const open = useRuntimeLogStore((state) => state.open);
  const hide = useRuntimeLogStore((state) => state.hide);
  useEffect(startRuntimeLogSync, []);
  useEffect(startNativeLogPolling, []);
  return <>
    <NotificationContainer />
    {open && <RuntimeLogDialog onClose={hide} />}
  </>;
}
