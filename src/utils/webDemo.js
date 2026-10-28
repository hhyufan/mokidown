import i18n from '@/i18n';
import useNotificationStore from '@store/useNotificationStore';

/**
 * 网站演示构建（`vite build --mode demo`）专用。
 *
 * 主项目构建里 `__MOKI_WEB_DEMO__` 被编译成 `false`，这些分支随之消失；
 * 演示构建里为 `true`，用来把只能依赖桌面壳（Tauri）的入口换成友好提示。
 */
export const isWebDemo = () => typeof __MOKI_WEB_DEMO__ !== 'undefined' && __MOKI_WEB_DEMO__;

/**
 * 演示里不可用的桌面能力：给一条右上角友好提示，而不是静默失败或抛错。
 *
 * @param {string} [message] 面向访客的说明。
 */
export function notifyWebDemo(message = i18n.t('webDemo.desktopRequired')) {
  useNotificationStore.getState().notify('info', i18n.t('webDemo.title'), message);
}
