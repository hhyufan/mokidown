import { useState } from 'react';
import { Button, Input, Space } from 'antd';
import { open } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import useExtensionStore from '@store/useExtensionStore';

export default function ExtensionSettings({ entry, act }) {
  const { t } = useTranslation();
  const [endpoint, setEndpoint] = useState(entry.settings.endpoint || '');
  const [credential, setCredential] = useState('');
  const [diagnostic, setDiagnostic] = useState('');
  const network = entry.package.permissions?.includes('network');
  const workspaceAccess = entry.package.permissions?.some((permission) => permission.startsWith('workspace.'));
  return <Space direction="vertical" style={{ width: '100%' }}>
    {network && <><p>{t('extensions.connectionHelp')}</p>
      <Input aria-label={t('extensions.endpoint')} placeholder="http://127.0.0.1:8787" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} />
      <Input.Password aria-label={t('extensions.credential')} placeholder={t('extensions.credential')} autoComplete="off" value={credential} onChange={(event) => setCredential(event.target.value)} /></>}
    <Space wrap>
      <Button onClick={() => act(async () => {
        await useExtensionStore.getState().configure(entry.package.id, { ...entry.settings, endpoint }, credential);
        setCredential('');
      })}>{t('extensions.save')}</Button>
      {network && <Button onClick={() => act(async () => {
        setDiagnostic('');
        await useExtensionStore.getState().configure(entry.package.id, { ...entry.settings, endpoint }, credential);
        setCredential('');
        const url = `${endpoint.trim().replace(/\/+$/, '')}/capabilities`;
        const result = await invoke('extension_http_request', { url, method: 'GET', body: null, credentialId: entry.package.id });
        if (result.status === 401 || result.status === 403) throw new Error(t('extensions.keyRejected'));
        if (result.status !== 200) throw new Error(`HTTP ${result.status}: ${t('extensions.checkProxy')}`);
        let data;
        try { data = JSON.parse(result.body); } catch { throw new Error(t('extensions.checkProxy')); }
        if (!data.service || !Array.isArray(data.plugins)) throw new Error(t('extensions.checkProxy'));
        setDiagnostic(`${t('extensions.connectionOk')} · ${data.service}`);
      })}>{t('extensions.testConnection')}</Button>}
      {workspaceAccess && <><Button onClick={() => act(async () => {
        const workspace = await open({ directory: true, multiple: false });
        if (typeof workspace === 'string') await useExtensionStore.getState().configure(entry.package.id, { ...entry.settings, endpoint, workspace }, credential);
        setCredential('');
      })}>{t('extensions.workspace')}</Button>
      <span>{entry.settings.workspace || t('extensions.noWorkspace')}</span></>}
    </Space>
    {diagnostic && <p role="status">{diagnostic}</p>}
  </Space>;
}

