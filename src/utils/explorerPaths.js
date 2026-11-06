import { isSafUri } from './tauriApi';

export function parentDirectory(path = '') {
  if (!path || isSafUri(path)) return '';
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalized.startsWith('web:')) {
    const parts = normalized.slice(6).split('/').filter(Boolean);
    return parts.length > 1 ? `web://${parts.slice(0, -1).join('/')}` : '';
  }
  if (/^[a-z]:$/i.test(normalized)) return '';
  if (normalized.startsWith('//')) {
    const parts = normalized.slice(2).split('/');
    return parts.length > 2 ? `\\\\${parts.slice(0, -1).join('\\')}` : '';
  }
  const split = normalized.lastIndexOf('/');
  if (split < 0) return '';
  const parent = normalized.slice(0, split);
  if (/^[a-z]:$/i.test(parent)) return `${parent}\\`;
  return path.includes('\\') ? parent.replace(/\//g, '\\') : parent || '/';
}

export function explorerPathKey(path = '') {
  const value = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-z]:/i.test(value) || value.startsWith('//') ? value.toLowerCase() : value;
}
