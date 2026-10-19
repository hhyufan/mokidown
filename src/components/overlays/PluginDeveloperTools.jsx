import { useState } from 'react';
import { Button, Input, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import ChevronIcon from '@components/ui/ChevronIcon';
import useExtensionStore from '@store/useExtensionStore';
import useThemeStore from '@store/useThemeStore';
import AppDialog from './AppDialog';
import './service-extensions.scss';

export default function PluginDeveloperTools({ desktop }) {
  const { t } = useTranslation();
  const sources = useExtensionStore((state) => state.developmentSources);
  const theme = useThemeStore((state) => state.theme);
  const [url, setUrl] = useState('http://127.0.0.1:3141/package');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [docs, setDocs] = useState(false);
  return <>
    <details className="service-extensions__developer">
      <summary><ChevronIcon className="service-extensions__developer-chevron" />{t('extensions.developer')}</summary>
      <p>{t('extensions.developerHint')}</p>
      <Space.Compact style={{ width: '100%' }}>
        <Input aria-label={t('extensions.developmentUrl')} value={url} onChange={(event) => setUrl(event.target.value)} />
        <Button disabled={!desktop} loading={busy} onClick={async () => {
          setBusy(true); setError('');
          try { await useExtensionStore.getState().connectDevelopment(url); }
          catch (error) { setError(String(error?.message || error)); }
          finally { setBusy(false); }
        }}>{t('extensions.connectDevelopment')}</Button>
      </Space.Compact>
      {error && <p role="alert">{error}</p>}
      {sources.map((source) => <div className="service-extensions__development-source" key={source.token}>
        <span><strong>{source.id}</strong><small>{source.url}</small>{source.error && <small role="alert">{source.error}</small>}</span>
        <Button onClick={() => useExtensionStore.getState().disconnectDevelopment(source.id)}>{t('extensions.disconnectDevelopment')}</Button>
      </div>)}
      <Button type="link" onClick={() => setDocs(true)}>{t('extensions.developerDocs')}</Button>
    </details>
    <AppDialog open={docs} onCancel={() => setDocs(false)} title={t('extensions.developerDocs')} footer={null} width={1180} destroyOnClose>
      <iframe className="service-extensions__documentation" title={t('extensions.developerDocs')} src={`${new URL('docs/plugins/index.html', document.baseURI).href}?theme=${theme}`} sandbox="allow-scripts allow-same-origin" />
    </AppDialog>
  </>;
}
