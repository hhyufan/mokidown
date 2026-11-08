import { useEffect, useState } from 'react';
import { Button, Select } from 'antd';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { useTranslation } from 'react-i18next';
import useNotificationStore from '@store/useNotificationStore';
import { startNativeLogPolling, useRuntimeLogStore } from '@/services/runtimeLogs';
import NotificationContainer from '@components/notification/NotificationContainer';
import AppDialog from './AppDialog';
import './runtime-logs.scss';

async function exportLogs(entries) {
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

function RuntimeLogDialog({ onClose }) {
  const { t } = useTranslation();
  const entries = useRuntimeLogStore((state) => state.entries);
  const [level, setLevel] = useState('all');
  const [exporting, setExporting] = useState(false);
  const visible = level === 'all' ? entries : entries.filter((entry) => entry.level === level);

  const handleExport = async () => {
    setExporting(true);
    try {
      if (await exportLogs(visible)) useNotificationStore.getState().notify('success', t('runtimeLogs.exported'));
    } catch (error) {
      useNotificationStore.getState().notify('error', t('runtimeLogs.exportFailed'), String(error?.message || error));
    } finally {
      setExporting(false);
    }
  };

  return (
    <AppDialog open onCancel={onClose} title={t('runtimeLogs.title')} width={760}
      footer={<Button type="primary" onClick={handleExport} disabled={!visible.length} loading={exporting}>
        {t('runtimeLogs.export')}
      </Button>}>
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
  useEffect(startNativeLogPolling, []);
  return <>
    <NotificationContainer />
    {open && <RuntimeLogDialog onClose={hide} />}
  </>;
}
