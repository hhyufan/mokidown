import { useState } from 'react';
import { Button, Input, Space, Switch } from 'antd';
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { useTranslation } from 'react-i18next';
import ExtensionSettings from './ExtensionSettings';
import useExtensionStore, { OFFICIAL_EXTENSIONS } from '@store/useExtensionStore';


export default function ServiceExtensions() {
  const { t, i18n } = useTranslation();
  const state = useExtensionStore();
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const desktop = Boolean(window.__TAURI_INTERNALS__) && !window.AndroidBridge;
  const act = async (action) => { setError(''); try { await action(); } catch (error) { setError(String(error?.message || error)); } };
  const officialIds = new Set(OFFICIAL_EXTENSIONS.map((entry) => entry.id));
  const cards = [
    ...OFFICIAL_EXTENSIONS.map((descriptor) => ({ descriptor, entry: state.installed.find((entry) => entry.package.id === descriptor.id) || { package: descriptor, enabled: false, settings: {} }, official: true })),
    ...state.installed.filter((entry) => !officialIds.has(entry.package.id)).map((entry) => ({ descriptor: entry.package, entry, official: false })),
  ];
  return <section className="service-extensions">
    <h3>{t('extensions.title')}</h3><p>{t('extensions.description')}</p>
    {error && <p role="alert">{error}</p>}
    {cards.map(({ descriptor, entry, official }) => <article key={descriptor.id} className="service-extensions__card">
      <div className="service-extensions__row">
        <div className="service-extensions__identity">
          <strong>{descriptor.name}</strong>
          {official && <span className="service-extensions__badge">{t('extensions.builtin')}</span>}
          <span className="service-extensions__version">v{entry.package.version}</span>
        </div>
        <Space wrap>
          <span>{t(entry.enabled ? 'extensions.enabled' : 'extensions.disabled')}</span>
          <Switch disabled={!desktop} loading={busyId === descriptor.id} checked={entry.enabled} aria-label={descriptor.name}
            onChange={(value) => act(async () => {
              setBusyId(descriptor.id);
              try { if (value) await state.ensureInstalled(descriptor.id); state.toggle(descriptor.id, value); }
              finally { setBusyId(null); }
            })} />
          <Button disabled={!desktop} onClick={() => setExpandedId(expandedId === descriptor.id ? null : descriptor.id)}>{t('extensions.configure')}</Button>
          {!official && <Button disabled={!desktop} danger onClick={() => act(() => state.uninstall(descriptor.id))}>{t('extensions.uninstall')}</Button>}
        </Space>
      </div>
      {(descriptor.description || descriptor.descriptionZh) && <p>{i18n.language.startsWith('zh') ? descriptor.descriptionZh || descriptor.description : descriptor.description || descriptor.descriptionZh}</p>}
      {state.runtimeErrors[descriptor.id] && <p role="alert">{state.runtimeErrors[descriptor.id]}</p>}
      {expandedId === descriptor.id && <div className="service-extensions__settings"><ExtensionSettings entry={entry} act={act} /></div>}
    </article>)}
    <details className="service-extensions__advanced">
      <summary>{t('extensions.thirdParty')}</summary>
      <p>{t('extensions.thirdPartyDescription')}</p>
      <Input aria-label={t('extensions.catalog')} placeholder={t('extensions.catalog')} value={state.catalogUrl} onChange={(event) => state.setCatalogUrl(event.target.value)} />
      <Space wrap style={{ margin: '12px 0' }}>
        <Button disabled={!desktop || !state.catalogUrl.trim()} onClick={() => act(state.refreshCatalog)}>{t('extensions.refresh')}</Button>
        <Button disabled={!desktop} onClick={() => act(async () => {
          const path = await open({ multiple: false, filters: [{ name: 'MokiDown plugin', extensions: ['json'] }] });
          if (typeof path === 'string') await state.installPackage(await readTextFile(path));
        })}>{t('extensions.import')}</Button>
      </Space>
      {state.error && <p role="alert">{state.error}</p>}
      {state.catalog.filter((item) => !officialIds.has(item.id) && !state.installed.some((entry) => entry.package.id === item.id)).map((item) => <article key={item.id}>
        <strong>{item.name}</strong> <Button disabled={!desktop} onClick={() => act(() => state.installFromCatalog(item))}>{t('extensions.install')}</Button>
      </article>)}
    </details>
  </section>;
}
