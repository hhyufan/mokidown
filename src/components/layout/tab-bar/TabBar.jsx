/**
 * 顶部标签栏模块。
 *
 * 组织编辑器多标签切换、标签重命名、设备同步开关，以及 Markdown 相关工具按钮，
 * 为主编辑区提供高频文件操作入口。
 */
import { useRef, useCallback, useMemo, useState, useLayoutEffect, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';
import useEditorStore from '@store/useEditorStore';
import useConfigStore from '@store/useConfigStore';

import useFileStore from '@store/useFileStore';

import useNotificationStore from '@store/useNotificationStore';
import useScriptStore from '@store/useScriptStore';
import { renameFile } from '@utils/tauriApi';
import { useFileManager } from '@hooks/useFileManager';
import { useEditorContextMenu } from '@hooks/useEditorContextMenu';
import { useHotkeys } from '@hooks/useHotkeys';
import { formatKeybinding } from '@utils/keybinding';
import EditorContextMenu from '@components/editor/EditorContextMenu';

import { moveDiskBaseline } from '@/services/localFileGuard';
import { beginReaderTabDetachWatch, buildDragPreview, cancelReaderTabDetachWatch, detachMarkdownTab } from '@/services/readerWindows';
import { consoleAvailable, outputToolsAvailable, terminalSupported } from '@utils/consoleSupport';
import { cn } from '@utils/classNames';
import { isImeComposing } from '@utils/keyboard';
import FileTypeIcon from '@components/ui/FileTypeIcon';
import './tabbar.scss';
import '@/assets/styles/rename-input.scss';
import { installTabStripWheel } from './tabStripWheel';
import { installTabStripDrag } from './tabStripDrag';
import { beginWindowDrag, isWindowDragExcluded } from '@utils/windowDrag';

const TAB_MOTION = { duration: 180, easing: 'cubic-bezier(.2,.75,.25,1)' };

function animateTabExit(layer, tab, scrollLeft) {
  if (!layer || !tab.element.animate) return;
  const left = tab.left - scrollLeft;
  if (left >= layer.clientWidth || left + tab.width <= 0) return;
  const ghost = tab.element.cloneNode(true);
  ghost.removeAttribute('data-tab-id');
  ghost.classList.add('tabbar__tab-exit');
  ghost.querySelector('input')?.remove();
  Object.assign(ghost.style, {
    left: `${left}px`, top: `${tab.top}px`, width: `${tab.width}px`, height: `${tab.height}px`,
  });
  layer.appendChild(ghost);
  const animation = ghost.animate([
    { opacity: 1, transform: 'translateY(0)' },
    { opacity: 0, transform: 'translateY(5px)' },
  ], { ...TAB_MOTION, duration: 140 });
  void animation.finished.then(() => ghost.remove(), () => ghost.remove());
}

/**
 * 顶部标签栏。
 *
 * 承载文件标签切换、重命名、关闭、新建、设备同步开关、工具栏开关与 Markdown
 * 分栏视图切换等高频编辑器操作。
 *
 * @returns {JSX.Element} 标签栏界面。
 */
function TabBar({ onRequestCloseTab, onRequestCloseTabs }) {
  const { t } = useTranslation();
  const { keybindingOf } = useHotkeys();
  const tabs = useEditorStore((s) => s.tabRenderList);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const renameTab = useEditorStore((s) => s.renameTab);
  const updateTabPath = useEditorStore((s) => s.updateTabPath);
  const reorderTabs = useEditorStore((s) => s.reorderTabs);
  const viewMode = useEditorStore((s) => s.viewMode);
  const toggleSplit = useEditorStore((s) => s.toggleSplit);
  const toolbarVisible = useEditorStore((s) => s.toolbarVisible);
  const toggleToolbar = useEditorStore((s) => s.toggleToolbar);
  const consoleOpen = useScriptStore((s) => s.open);
  const toggleConsole = useScriptStore((s) => s.setOpen);
  const notify = useNotificationStore((s) => s.notify);
  const autoSave = useConfigStore((s) => s.autoSave);

  const currentDir = useFileStore((s) => s.currentDir);
  const { loadDirectory, createNewTab, openFileDialog } = useFileManager();
  const { menu, openMenu, closeMenu } = useEditorContextMenu(tabs);
  const scrollRef = useRef(null);
  const exitLayerRef = useRef(null);
  const scrollLeftRef = useRef(0);
  const dragRef = useRef(null);
  const previousActiveRef = useRef(null);
  const positionsRef = useRef(new Map());
  const [draggedId, setDraggedId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const nativeDetachWatch = Boolean(window.__TAURI_INTERNALS__ && /Windows/i.test(navigator.userAgent));
  useEffect(() => installTabStripDrag(scrollRef.current, {
    nativeTracking: nativeDetachWatch,
    onDragChange: (id) => {
      dragRef.current = id;
      setDraggedId(id);
    },
    onGhost: (id, ghost, source, geometry) => {
      if (nativeDetachWatch) void beginReaderTabDetachWatch(id, buildDragPreview(source, undefined, ghost, geometry)).catch((error) => {
        console.error('[reader] Could not watch for an external tab drop:', error);
        window.dispatchEvent(new CustomEvent('reader:native-preview-failed', { detail: geometry.token }));
      });
    },
    onDropTarget: (target) => setDropTarget((current) => current?.id === target?.id && current?.after === target?.after ? current : target),
    onReorder: reorderTabs,
    onDetach: window.__TAURI_INTERNALS__ ? (id, position) => {
      if (nativeDetachWatch) return;
      void detachMarkdownTab(id, position).catch((error) => notify('error', t('reader.openFailed'), String(error)));
    } : undefined,
    onDragCancel: nativeDetachWatch ? () => {
      void cancelReaderTabDetachWatch().catch((error) => {
        console.error('[reader] Could not cancel external tab drop:', error);
      });
    } : undefined,
  }), [reorderTabs, notify, t, nativeDetachWatch]);
  useEffect(() => installTabStripWheel(scrollRef.current, scrollRef.current.closest('.tabbar')), []);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const elements = [...container.querySelectorAll('[data-tab-id]')];
    const previous = positionsRef.current;
    const lastScrollLeft = scrollLeftRef.current;
    const scrollLeft = container.scrollLeft;
    const positions = new Map(elements.map((element) => [element.dataset.tabId, {
      element, left: element.offsetLeft, top: element.offsetTop, width: element.offsetWidth, height: element.offsetHeight,
    }]));
    const added = [...positions.keys()].some((id) => !previous.has(id));
    const removed = [...previous.keys()].some((id) => !positions.has(id));
    const orderChanged = added || removed || [...previous.keys()].some((id, index) => id !== elements[index]?.dataset.tabId);
    if (orderChanged && !reducedMotion) {
      for (const [id, tab] of previous) {
        if (!positions.has(id)) animateTabExit(exitLayerRef.current, tab, lastScrollLeft);
      }
      for (const [id, tab] of positions) {
        const before = previous.get(id);
        if (!before) {
          tab.animation = tab.element.animate?.([{ opacity: 0, transform: 'translateX(12px)' }, { opacity: 1, transform: 'translateX(0)' }], TAB_MOTION);
        } else {
          const delta = before.left - lastScrollLeft - (tab.left - scrollLeft);
          before.animation?.cancel();
          if (delta) tab.animation = tab.element.animate?.([{ transform: `translateX(${delta}px)` }, { transform: 'translateX(0)' }], TAB_MOTION);
        }
      }
    } else {
      for (const [id, tab] of positions) tab.animation = previous.get(id)?.animation;
    }
    positionsRef.current = positions;
    scrollLeftRef.current = scrollLeft;
    const activeChanged = previousActiveRef.current !== activeTabId;
    previousActiveRef.current = activeTabId;
    if (dragRef.current) return;
    const behavior = reducedMotion ? 'auto' : 'smooth';
    if (activeChanged || added || removed) {
      const active = positions.get(activeTabId);
      if (active) {
        const right = active.left + active.width;
        if (active.left < scrollLeft) container.scrollTo({ left: active.left, behavior });
        else if (right > scrollLeft + container.clientWidth) container.scrollTo({ left: right - container.clientWidth, behavior });
      }
    }
  }, [tabs, activeTabId]);

  const [renamingTabId, setRenamingTabId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef(null);
  const activeTab = useMemo(
    () => tabs.find((item) => item.id === activeTabId) || null,
    [tabs, activeTabId],
  );
  const isMarkdown = useMemo(
    () => /^(md|markdown|mdx)$/i.test(activeTab?.ext || ''),
    [activeTab],
  );
  const canSplit = !activeTab?.builtin && /^(md|markdown|mdx|mgtree|html?|xhtml)$/i.test(activeTab?.ext || '');
  const canShowConsole = consoleAvailable(viewMode, activeTab);
  const terminalEnabled = terminalSupported();
  const consoleLabel = t(terminalEnabled ? 'terminal.title' : 'tabbar.console');

  /**
   * 进入标签重命名模式，并在下一帧自动聚焦输入框。
   *
   * @param {object} tab 待重命名的标签对象。
   * @param {MouseEvent} e 双击事件对象。
   */
  const startRename = useCallback((tab, e) => {
    if (tab.builtin) return;
    e?.stopPropagation();
    setRenamingTabId(tab.id);
    setRenameValue(tab.name);
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, []);

  const openTabMenu = (event, tab, fromNewButton = false) => {
    const shortcutOf = (actionId) => {
      const keybinding = keybindingOf(actionId);
      return keybinding ? formatKeybinding(keybinding, /Mac|iPod|iPhone|iPad/.test(navigator.platform)) : undefined;
    };
    const close = (key, targets, actionId) => ({ key, label: t(`tabbar.menu.${key}`), shortcut: shortcutOf(actionId),
      disabled: !targets.length, run: () => onRequestCloseTabs(targets.map(({ id }) => id)) });
    const creation = fromNewButton ? [
      { key: 'new', label: t('tabbar.newTab'), run: createNewTab },
      { key: 'open', label: t('tabbar.menu.openFile'), run: openFileDialog },
      { key: 'creation-separator', separator: true },
    ] : [];
    openMenu(event, [...creation,
      close('close', [tab], 'closeTab'), close('closeOthers', tabs.filter(({ id }) => id !== tab.id), 'closeOtherTabs'),
      close('closeAll', tabs, 'closeAllTabs'),
    ], 'tab');
  };

  /**
   * 提交标签重命名；对已落盘文件会同步更新磁盘路径与同步映射。
   *
   * @param {object} tab 当前重命名的标签对象。
   * @returns {Promise<void>} 重命名流程结束后刷新相关状态。
   */
  const commitRename = useCallback(async (tab) => {
    const trimmed = renameValue.trim();
    setRenamingTabId(null);
    if (!trimmed || trimmed === tab.name) return;

    if (!tab.path) {
      // 未落盘标签仅修改显示名，真正保存路径交由后续系统对话框决定。
      renameTab(tab.id, trimmed);
      return;
    }

    // 已落盘文件需要同时完成磁盘重命名、编辑器状态与同步映射更新。
    const sep = tab.path.includes('\\') ? '\\' : '/';
    const dir = tab.path.substring(0, tab.path.lastIndexOf(sep) + 1);
    const newPath = dir + trimmed;
    try {
      const result = await renameFile(tab.path, newPath);
      if (result?.success !== false) {
        const actualPath = result?.file_path || newPath;
        moveDiskBaseline(tab.path, actualPath);
        updateTabPath(tab.id, actualPath, trimmed);
        
        if (currentDir) loadDirectory(currentDir);
      } else {
        notify('error', t('notification.renameFailed'), result?.message || '');
      }
    } catch (err) {
      notify('error', t('notification.renameFailed'), String(err));
    }
  }, [renameValue, renameTab, updateTabPath, notify, t, currentDir, loadDirectory]);

  /**
   * 退出标签重命名模式并丢弃当前输入。
   */
  const cancelRename = useCallback(() => {
    setRenamingTabId(null);
  }, []);

  /**
   * 向左平滑滚动标签列表，便于访问被遮挡的标签。
   */
  const scrollLeft = useCallback(() => {
    scrollRef.current?.scrollBy({ left: -120, behavior: 'smooth' });
  }, []);

  /**
   * 向右平滑滚动标签列表，便于访问被遮挡的标签。
   */
  const scrollRight = useCallback(() => {
    scrollRef.current?.scrollBy({ left: 120, behavior: 'smooth' });
  }, []);

  return (
    <div className="tabbar" onMouseDown={(event) => { if (!isWindowDragExcluded(event.target)) beginWindowDrag(event); }}>
      <EditorContextMenu menu={menu} onClose={closeMenu} />
      <div className="tabbar__actions tabbar__actions--left">
        <Tooltip title={t('tabbar.scrollLeft')} placement="bottom" mouseEnterDelay={0.3}>
          <button onClick={scrollLeft} type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </Tooltip>
      </div>

      <div className="tabbar__strip">
      <div className="tabbar__tabs" ref={scrollRef} onScroll={(event) => { scrollLeftRef.current = event.currentTarget.scrollLeft; }}>
        {tabs.map((tab) => {
          const isRenaming = renamingTabId === tab.id;
          
          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              draggable={false}
              className={cn('tabbar__tab', activeTabId === tab.id && 'tabbar__tab--active', isRenaming && 'tabbar__tab--renaming', draggedId === tab.id && 'tabbar__tab--dragging', dropTarget?.id === tab.id && (dropTarget.after ? 'tabbar__tab--drop-after' : 'tabbar__tab--drop-before'))}
              onClick={() => !isRenaming && setActiveTab(tab.id)}
              onContextMenu={(event) => { if (!isRenaming) openTabMenu(event, tab); }}

            >
              <span className="tabbar__tab-icon">
                {tab.builtin === 'web'
                  ? <WebTabIcon tab={tab} />
                  : <FileTypeIcon extension={tab.ext} fileName={tab.name} size={16} />}
              </span>

              <span className="tabbar__tab-label">
                <span className="tabbar__tab-name" style={isRenaming ? { visibility: 'hidden' } : undefined} onDoubleClick={(e) => startRename(tab, e)}>{tab.name}</span>
              {isRenaming && (
                <input
                  ref={renameInputRef}
                  className="moki-rename-input tabbar__tab-rename"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => commitRename(tab)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    // 重命名输入框同样要先放行输入法组合，否则回车上屏候选词会
                    // 直接被当成「确认重命名」，中文文件名输入不下来。
                    if (isImeComposing(e)) return;
                    if (e.key === 'Enter') { e.preventDefault(); commitRename(tab); }
                    if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              )}
              </span>

              {tab.modified && !autoSave && <span className="tabbar__tab-dot" style={isRenaming ? { visibility: 'hidden' } : undefined} />}
              {(
                <span
                  className="tabbar__tab-close"
                  style={isRenaming ? { visibility: 'hidden' } : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRequestCloseTab?.(tab.id);
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </span>
              )}
            </div>
          );
        })}
        {tabs.length > 0 && <Tooltip title={t('tabbar.newTab')} placement="bottom" mouseEnterDelay={0.3}>
          <button className="tabbar__new-tab" aria-label={t('tabbar.newTab')} onClick={createNewTab} type="button"
            onContextMenu={(event) => { if (activeTab) openTabMenu(event, activeTab, true); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </Tooltip>}
      </div>
      <div className="tabbar__exits" ref={exitLayerRef} aria-hidden="true" inert="" />
      </div>

      <div className="tabbar__actions">
        <Tooltip title={t('tabbar.scrollRight')} placement="bottom" mouseEnterDelay={0.3}>
          <button onClick={scrollRight} type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </Tooltip>
        {isMarkdown && (
          <Tooltip title={t('tabbar.toggleToolbar')} placement="bottom" mouseEnterDelay={0.3}>
            <button
              className={cn('tabbar__action-btn', toolbarVisible && 'tabbar__action-btn--active')}
              onClick={toggleToolbar}
              aria-label={t('tabbar.toggleToolbar')}
              aria-pressed={toolbarVisible}
              type="button"
            >
              <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" fill="none" />
                <line x1="3" y1="15" x2="21" y2="15" />
                {toolbarVisible && <rect x="3" y="15" width="18" height="6" rx="0" fill="currentColor" stroke="none" />}
              </svg>
            </button>
          </Tooltip>
        )}
        {canSplit && (
          <Tooltip title={t('tabbar.splitView')} placement="bottomRight" mouseEnterDelay={0.3}>
            <button
              className={cn('tabbar__action-btn', viewMode === 'split' && 'tabbar__action-btn--active')}
              onClick={toggleSplit}
              aria-label={t('tabbar.splitView')}
              aria-pressed={viewMode === 'split'}
              type="button"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="12" y1="3" x2="12" y2="21" />
              </svg>
            </button>
          </Tooltip>
        )}
        {canShowConsole && (
          <Tooltip title={consoleLabel} placement="bottomRight" mouseEnterDelay={0.3}>
            <button
              className={cn('tabbar__action-btn', consoleOpen && 'tabbar__action-btn--active')}
              onClick={() => {
                if (!terminalEnabled) { toggleConsole(!consoleOpen); return; }
                const panel = useScriptStore.getState();
                if (panel.open && (panel.toolTab === 'terminal' || !outputToolsAvailable(viewMode, activeTab))) panel.setOpen(false);
                else panel.setToolTab('terminal');
              }}
              aria-label={consoleLabel}
              type="button"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m5 7 5 5-5 5M13 17h6" />
              </svg>
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

// 网页标签优先显示站点 favicon，取不到时回退到 HTML 文件图标。
function WebTabIcon({ tab }) {
  const urls = tab.faviconUrls || (tab.favicon ? [tab.favicon] : []);
  return <WebTabFavicon key={JSON.stringify(urls)} urls={urls} name={tab.name} />;
}

function WebTabFavicon({ urls, name }) {
  const [index, setIndex] = useState(0);
  if (!urls[index]) return <FileTypeIcon extension="html" fileName={name} size={16} />;
  return <img className="tabbar__tab-favicon" src={urls[index]} alt="" width={16} height={16}
    draggable={false} onError={() => setIndex((value) => value + 1)} />;
}

export default TabBar;
