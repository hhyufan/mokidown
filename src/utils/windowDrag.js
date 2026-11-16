import { appWindow } from '@utils/tauriApi';

// 这些元素需要自己处理鼠标事件，不能作为窗口拖动区域。
const INTERACTIVE_SELECTOR = [
  'button',
  'a',
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[data-no-drag]',
  '.titlebar__search',
  '.tabbar__tab',
  '.tabbar__actions',
  '.footer__breadcrumb',
  '.file-tree__item',
  '.project-tree__row',
  '.sidebar__recent-item',
  '[role="menu"]',
  '.moki-context-menu',
  '.ant-dropdown',
  '.ant-select-dropdown',
  '.ant-modal-root',
  '.monaco-editor',
].join(', ');

/**
 * 判断鼠标目标是否属于可交互控件；是则不应触发窗口拖动。
 *
 * @param {EventTarget|null} target 鼠标事件目标。
 * @returns {boolean} 命中交互控件时为 true。
 */
export function isWindowDragExcluded(target) {
  return Boolean(target?.closest?.(INTERACTIVE_SELECTOR));
}

/**
 * 通过 Tauri 原生窗口开始拖动；双击切换最大化。
 *
 * @param {MouseEvent} event 鼠标按下事件。
 * @param {object} [options] 选项。
 * @param {boolean} [options.maximized] 当前是否已最大化。
 * @returns {void}
 */
export function beginWindowDrag(event, { maximized } = {}) {
  if (event.button !== 0 || !appWindow?.startDragging) return;
  event.preventDefault();
  // 只有标题栏知道最大化状态；其它空白区域双击不切换最大化。
  const action = event.detail === 2 && maximized !== undefined
    ? (maximized ? appWindow.unmaximize() : appWindow.maximize())
    : appWindow.startDragging();
  action?.catch?.(() => {});
}
