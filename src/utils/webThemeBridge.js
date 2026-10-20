import useThemeStore from '@store/useThemeStore';

/**
 * 网站演示用主题桥。
 *
 * 官网把演示应用放在独立域名（GitHub Pages / OSS）时，父页面无法直接
 * 读取 iframe 的 DOM，因此改用 postMessage 下发主题。
 */
let teardown;
export function installWebThemeBridge(enabled = typeof __MOKI_WEB_DEMO__ !== 'undefined' && __MOKI_WEB_DEMO__) {
  if (!enabled) return;
  if (teardown) return teardown;
  let applying = false;
  let previous = useThemeStore.getState().theme;
  const notify = (theme, requestId) => {
    if (window.parent !== window) window.parent.postMessage({ type: 'moki:theme-changed', theme, ...(requestId === undefined ? {} : { requestId }) }, '*');
  };
  const handle = (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.type !== 'moki:theme') return;
    if (data.theme === 'light' || data.theme === 'dark') {
      applying = true;
      try { useThemeStore.getState().setTheme(data.theme); }
      finally { applying = false; }
      notify(data.theme, data.requestId);
    }
  };
  const stop = useThemeStore.subscribe((state) => {
    if (state.theme === previous) return;
    previous = state.theme;
    if (!applying) notify(state.theme);
  });
  window.addEventListener('message', handle);
  if (window.parent !== window) window.parent.postMessage({ type: 'moki:theme-ready' }, '*');
  teardown = () => { window.removeEventListener('message', handle); stop(); teardown = undefined; };
  return teardown;
}

export default installWebThemeBridge;
