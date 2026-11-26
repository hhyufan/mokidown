import { localize as upstream, localize2 as upstream2 } from 'monaco-editor/esm/vs/nls.js';
import messages from 'virtual:moki-monaco-zh';
import { readInitialLanguage } from '@/i18n/language';

export { getNLSLanguage, getNLSMessages } from 'monaco-editor/esm/vs/nls.js';

const startupLanguage = readInitialLanguage();

function translate(message) {
  return startupLanguage === 'zh' && Object.hasOwn(messages, message) ? messages[message] : message;
}

export function localize(key, message, ...args) {
  return upstream(key, typeof key === 'number' ? message : translate(message), ...args);
}

export function localize2(key, message, ...args) {
  if (typeof key === 'number') return upstream2(key, message, ...args);
  return {
    value: upstream(key, translate(message), ...args),
    original: upstream(key, message, ...args),
  };
}
