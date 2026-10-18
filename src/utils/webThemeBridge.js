import useThemeStore from '@store/useThemeStore';

/**
 * 网站演示用主题桥。
 *
 * 官网把演示应用放在独立域名（GitHub Pages / OSS）时，父页面无法直接
 * 读取 iframe 的 DOM，因此改用 postMessage 下发主题。
 */
export function installWebThemeBridge() {
  if (typeof __MOKI_WEB_DEMO__ === 'undefined' || !__MOKI_WEB_DEMO__) return;
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.type !== 'moki:theme') return;
    if (data.theme === 'light' || data.theme === 'dark') {
      useThemeStore.getState().setTheme(data.theme);
    }
  });
}

export default installWebThemeBridge;
