import { useMemo, useState } from 'react';
import { Button, Input, Space } from 'antd';
import { FolderOpenOutlined } from '@ant-design/icons';
import { open } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import useExtensionStore from '@store/useExtensionStore';

/**
 * Plugin settings form.
 *
 * The fields, help text and button labels come from the plugin's own
 * `configuration` declaration (manifest / catalog entry). The editor only
 * renders generic field types — url, secret, directory — and never hardcodes
 * what a specific plugin asks for.
 */
export default function ExtensionSettings({ entry, act }) {
  const { t } = useTranslation();
  const config = entry.package.configuration && Array.isArray(entry.package.configuration.fields)
    ? entry.package.configuration
    : null;
  const fields = config ? config.fields : [];
  const labels = config?.actions || {};
  const [values, setValues] = useState(() => ({
    endpoint: entry.settings.endpoint || '',
    credential: '',
  }));
  const [workspace, setWorkspace] = useState(entry.settings.workspace || '');
  const [diagnostic, setDiagnostic] = useState('');
  const [diagnosticTone, setDiagnosticTone] = useState('success');
  const has = useMemo(() => (type) => fields.some((field) => field.type === type), [fields]);

  const save = async (extra = {}) => {
    const settings = { ...entry.settings, endpoint: values.endpoint, ...extra };
    await useExtensionStore.getState().configure(entry.package.id, settings, values.credential);
    setValues((current) => ({ ...current, credential: '' }));
  };

  // No configuration declared by the plugin: nothing to render here.
  if (!config) return <p>{t('extensions.noConfiguration')}</p>;

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {config.help && <p>{config.help}</p>}
      {typeof config.html === 'string' && config.html.trim() && (
        // Plugins may embed their own styled HTML. It runs inside a sandboxed
        // frame without scripts, so it can style/describe but not touch the app.
        <iframe
          className="extension-settings__html"
          sandbox=""
          title="plugin configuration"
          srcDoc={`<!doctype html><meta charset="utf-8"><style>${typeof config.css === 'string' ? config.css : ''}</style>${config.html}`}
        />
      )}
      {fields.map((field) => {
        if (field.type === 'secret') {
          return (
            <Input.Password
              key={field.key}
              aria-label={field.label}
              placeholder={field.label}
              autoComplete="off"
              value={values.credential}
              onChange={(event) => setValues((current) => ({ ...current, credential: event.target.value }))}
            />
          );
        }
        if (field.type === 'directory') {
          return (
            <div key={field.key} className="extension-settings__directory">
              <FolderOpenOutlined className="extension-settings__folder" />
              <span className="extension-settings__path" title={workspace || ''}>
                {workspace || t('extensions.noWorkspace')}
              </span>
              <Button size="small" onClick={() => act(async () => {
                const picked = await open({ directory: true, multiple: false });
                if (typeof picked === 'string') {
                  setWorkspace(picked);
                  await save({ workspace: picked });
                }
              })}>{field.label}</Button>
            </div>
          );
        }
        return (
          <Input
            key={field.key}
            aria-label={field.label}
            placeholder={field.placeholder || field.label}
            value={values.endpoint}
            onChange={(event) => setValues((current) => ({ ...current, endpoint: event.target.value }))}
          />
        );
      })}
      <Space wrap>
        {has('url') && (
          <Button type="primary" onClick={() => act(async () => {
            setDiagnostic('');
            try {
              await save();
              const url = `${values.endpoint.trim().replace(/\/+$/, '')}/capabilities`;
              const result = await invoke('extension_http_request', { url, method: 'GET', body: null, credentialId: entry.package.id });
              if (result.status === 401 || result.status === 403) throw new Error(t('extensions.keyRejected'));
              if (result.status !== 200) throw new Error(`HTTP ${result.status}: ${t('extensions.checkProxy')}`);
              let data;
              try { data = JSON.parse(result.body); } catch { throw new Error(t('extensions.checkProxy')); }
              if (!data.service || !Array.isArray(data.plugins)) throw new Error(t('extensions.checkProxy'));
              setDiagnosticTone('success');
              setDiagnostic(`${t('extensions.connectionOk')} · ${data.service}`);
            } catch (err) {
              setDiagnosticTone('error');
              setDiagnostic(String(err?.message || err));
            }
          })}>{labels.test}</Button>
        )}
      </Space>
      {diagnostic && (
        <p className={`extension-settings__diagnostic is-${diagnosticTone}`} role="status">{diagnostic}</p>
      )}
    </Space>
  );
}
