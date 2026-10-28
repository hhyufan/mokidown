import i18n from '@/i18n';
/**
 * ?????????
 *
 * ??????????????????????????????
 */
import { create } from 'zustand';

let notifId = 0;

/**
 * 全局通知中心 store。
 *
 * 管理带标题的通知队列，并在指定时长后自动移除，供顶部通知容器统一渲染。
 */
const useNotificationStore = create((set) => ({
  notifications: [],

  /**
   * 追加一条通知；`duration <= 0` 时保持常驻，等待手动关闭。
   */
  notify: (type, title, message = '', duration = 4000) => {
    // Demo builds run the app in a browser without a Tauri runtime. Explain the
    // limitation instead of leaking invoke/TypeError text into a red error.
    const webDemo = typeof __MOKI_WEB_DEMO__ !== 'undefined' && __MOKI_WEB_DEMO__;
    const technical =
      /invoke|__TAURI_INTERNALS__|File is no longer available|File not found|Cannot read properties of undefined|is not a function/i;
    let nextType = type;
    let nextTitle = title;
    let nextMessage = message;
    if (webDemo && type === 'error' && technical.test(`${title} ${message}`)) {
      nextType = 'info';
      nextTitle = i18n.t('webDemo.title');
      nextMessage = i18n.t('webDemo.desktopRequired');
    }
    const id = ++notifId;
    set((state) => ({
      notifications: [
        ...state.notifications,
        { id, type: nextType, title: nextTitle, message: nextMessage, duration },
      ],
    }));
    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        }));
      }, duration);
    }
  },

  /**
   * 按通知 ID 主动关闭指定项。
   */
  dismiss: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),
}));

export default useNotificationStore;
