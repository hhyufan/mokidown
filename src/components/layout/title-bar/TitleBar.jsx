import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';
import { appWindow } from '@utils/tauriApi';
import useEditorStore from '@store/useEditorStore';
import { useResponsiveLayout } from '@hooks/useResponsiveLayout';
import SearchDropdown from './SearchDropdown';
import WindowPinIcon from '@components/ui/WindowPinIcon';
import './titlebar.scss';

/**
 * 标题栏按钮封装。
 *
 * 桌面端窗口控制按钮和通用入口按钮复用同一套样式与提示行为。
 */
function TbBtn({ title, className = 'titlebar__btn', onClick, children }) {
  return (
    <Tooltip title={title} placement="bottom" mouseEnterDelay={0.3}>
      <button className={className} aria-label={title} onClick={onClick} type="button">
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * 顶部标题栏。
 *
 * 负责侧边栏开关、搜索入口，以及桌面端的最小化/最大化/关闭窗口控制。
 * 在移动端与 Android 上则退化成更轻量的导航头。
 */
function TitleBar({ searchOpen, onOpenSearch, onCloseSearch, onRequestClose }) {
  const { t } = useTranslation();
  const toggleSidebar = useEditorStore((state) => state.toggleSidebar);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const { isMobileLayout, isAndroid } = useResponsiveLayout();
  const isDesktopWindow = !isMobileLayout && !isAndroid;

  useEffect(() => {
    // 最大化状态只能从原生窗口层读取；监听 resize 可兼容双击标题栏、
    // 系统快捷键和窗口控制按钮等多种切换入口。
    if (!isDesktopWindow) return undefined;
    appWindow.isMaximized().then(setIsMaximized);
    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then(setIsMaximized);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [isDesktopWindow]);

  useEffect(() => {
    // 置顶状态同样以原生窗口为准；非桌面环境（网页预览等）读取不到时保持未置顶。
    if (!isDesktopWindow) return undefined;
    appWindow
      .isAlwaysOnTop()
      .then((value) => setIsPinned(Boolean(value)))
      .catch(() => setIsPinned(false));
  }, [isDesktopWindow]);

  /**
   * 切换窗口置顶/取消置顶。
   *
   * @returns {void}
   */
  const togglePin = () => {
    const next = !isPinned;
    // 权限被拒绝等异常只回滚视觉状态，不让未处理的 Promise 拒绝冒泡到全局。
    appWindow
      .setAlwaysOnTop(next)
      .then(() => setIsPinned(next))
      .catch(() => setIsPinned(false));
  };

  // A native CSS drag region handles right-clicks before the WebView can cancel
  // its system menu. Start only left-button drags through Tauri instead.
  const handleDragMouseDown = (event) => {
    if (!isDesktopWindow || event.button !== 0) return;
    event.preventDefault();
    const action = event.detail === 2
      ? (isMaximized ? appWindow.unmaximize() : appWindow.maximize())
      : appWindow.startDragging();
    action.catch(() => {});
  };

  return (
    <header className={`titlebar ${!isDesktopWindow ? 'titlebar--mobile' : ''}`}>
      <TbBtn title={t('topbar.toggleSidebar')} onClick={toggleSidebar}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
        </svg>
      </TbBtn>

      <SearchDropdown open={searchOpen} onOpen={onOpenSearch} onClose={onCloseSearch} />

      <div className="titlebar__drag" onMouseDown={handleDragMouseDown} onContextMenu={(event) => event.preventDefault()} />

      {isDesktopWindow && (
        <div className="titlebar__actions">
          <TbBtn
            title={isPinned ? t('topbar.unpin') : t('topbar.pin')}
            className={`titlebar__btn titlebar__btn--pin${isPinned ? ' is-pinned' : ''}`}
            onClick={togglePin}
          >
            <WindowPinIcon pinned={isPinned} />
          </TbBtn>
          <TbBtn title={t('topbar.minimize')} onClick={() => appWindow.minimize()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </TbBtn>
          <TbBtn
            title={isMaximized ? t('topbar.unmaximize') : t('topbar.maximize')}
            onClick={() => (isMaximized ? appWindow.unmaximize() : appWindow.maximize())}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
            </svg>
          </TbBtn>
          <TbBtn
            title={t('topbar.close')}
            className="titlebar__btn titlebar__btn--close"
            onClick={onRequestClose}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </TbBtn>
        </div>
      )}
    </header>
  );
}

export default TitleBar;
