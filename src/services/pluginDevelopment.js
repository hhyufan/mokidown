import i18n from '@/i18n';
import { invoke } from '@tauri-apps/api/core';
import { verifyPluginPackage } from '../../shared/plugin-package.mjs';

export function developmentPackageUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error(i18n.t('pluginErrors.localDevUrl'));
  return url.href;
}

export async function readDevelopmentPackage(value, previous) {
  const url = developmentPackageUrl(value);
  const response = await invoke('extension_http_request', { url, method: 'GET', body: null, credentialId: null });
  if (response.status !== 200) throw new Error(`${i18n.t('pluginErrors.devHttp', { status: response.status })}: ${response.body.slice(0, 300)}`);
  const result = await verifyPluginPackage(response.body, previous ? { id: previous.id } : {});
  if (previous && result.pkg.permissions.some((permission) => !previous.permissions.includes(permission))) throw new Error(i18n.t('pluginErrors.permissionsChanged'));
  return result;
}
