/**
 * @file 主侧边栏模块。
 *
 * 该文件组织 Explorer、Outline、Recent 三种侧边栏视图，以及底部主题、
 * 用户和设置等全局入口，是编辑器左侧工作流的主装配层。
 */
import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Dropdown, Tooltip, Button, Tag } from 'antd';
import useEditorStore from '@store/useEditorStore';

import useThemeStore from '@store/useThemeStore';
import useFileStore, { getScopedRecentFiles } from '@store/useFileStore';

import { GUEST_USER_SCOPE } from '@store/userScope';
import { useFileManager } from '@hooks/useFileManager';
import FileTree from './explorer/FileTree';
import OutlineView from './outline/OutlineView';
import SidebarResizer from './SidebarResizer';
import SidebarTabs from './SidebarTabs';
import KnowledgeTree from '@components/editor/KnowledgeTree';
import { useKnowledgeTrees } from '@hooks/useKnowledgeTrees';
import { useOpenTreeEditor } from '@hooks/useOpenTreeEditor';
import { useEditorBufferContent } from '@hooks/useEditorBufferContent';
import Timeline from '@components/history/Timeline';
import PluginPanel from './PluginPanel';

import FileTypeIcon from '@components/ui/FileTypeIcon';
import TreeExpansionIcon from '@components/ui/TreeExpansionIcon';
import AppMark from '@components/ui/AppMark';
import MokiStatusEmpty from '@components/moki/MokiStatusEmpty';
import { openExternal } from '@utils/tauriApi';
import { canCheckUpdates } from '@utils/appUpdater';
import useUpdateStore from '@store/useUpdateStore';
import { getVersion } from '@tauri-apps/api/app';
import { REPO_URL } from '@/configs/repository';
import { cn } from '@utils/classNames';
import './sidebar.scss';

/**
 * 侧边栏工具按钮。
 *
 * 统一封装浮层提示与视觉样式，减少 Explorer / Outline / Recent
 * 三组工具条里重复的按钮模板代码。
 *
 * @param {object} props 组件属性。
 * @param {string} props.title 按钮提示文案。
 * @param {Function} [props.onClick] 点击回调。
 * @param {import('react').ReactNode} props.children 按钮图标或内容。
 * @returns {JSX.Element} 统一样式的工具栏按钮。
 */
function ToolbarButton({ title, onClick, children }) {
  return (
    <Tooltip title={title} placement="bottom" mouseEnterDelay={0.3}>
      <div className="stb" onClick={onClick}>
        {children}
      </div>
    </Tooltip>
  );
}

/**
 * Explorer 排序菜单内容生成器。
 *
 * 用工厂函数而不是内联 JSX，是为了让 antd `popupRender` 在每次打开时
 * 都拿到最新排序状态，同时保持主组件结构可读。
 *
 * @param {object} options 排序菜单所需的状态与动作。
 * @returns {Function} 供 `Dropdown.popupRender` 调用的渲染函数。
 */
function renderSortDropdown({ sortBy, sortOrder, setSortBy, setSortOrder, t, close }) {
  return () => (
    <div className="sort-dropdown" onClick={(e) => e.stopPropagation()}>
      <div
        className={cn('sort-item', sortOrder === 'asc' && 'sort-item--active')}
        onClick={() => { setSortOrder('asc'); close(); }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6l4 4 4-4" /><path d="M7 10V2" /><path d="M21 12H11" /><path d="M21 6H11" /><path d="M21 18H11" /></svg>
        {t('sort.ascending')}
      </div>
      <div
        className={cn('sort-item', sortOrder === 'desc' && 'sort-item--active')}
        onClick={() => { setSortOrder('desc'); close(); }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 14l4 4 4-4" /><path d="M7 18V2" /><path d="M21 12H11" /><path d="M21 6H11" /><path d="M21 18H11" /></svg>
        {t('sort.descending')}
      </div>
      <div className="sort-divider" />
      <div
        className={cn('sort-item', sortBy === 'name' && 'sort-item--active')}
        onClick={() => { setSortBy('name'); close(); }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" /></svg>
        {t('sort.byName')}
      </div>
      <div
        className={cn('sort-item', sortBy === 'time' && 'sort-item--active')}
        onClick={() => { setSortBy('time'); close(); }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
        {t('sort.byTime')}
      </div>
      <div
        className={cn('sort-item', sortBy === 'size' && 'sort-item--active')}
        onClick={() => { setSortBy('size'); close(); }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 9h6v6H9z" /></svg>
        {t('sort.bySize')}
      </div>
    </div>
  );
}

/**
 * 资源管理器工具栏：排序、新建、保存、打开目录。
 */
function ExplorerToolbar() {
  const { t } = useTranslation();
  const { sortBy, sortOrder, setSortBy, setSortOrder } = useFileStore();
  const { saveCurrentFile, openFolderDialog, createFileWithDialog } = useFileManager();

  const [sortOpen, setSortOpen] = useState(false);
  const closeSort = useCallback(() => setSortOpen(false), []);

  return (
    <div className="sidebar__toolbar">
      <span className="sidebar__toolbar-label">{t('sidebar.explorer.title')}</span>
      <div style={{ position: 'relative' }}>
        <Dropdown
          open={sortOpen}
          onOpenChange={setSortOpen}
          trigger={['click']}
          placement="bottomRight"
          arrow={false}
          popupRender={renderSortDropdown({ sortBy, sortOrder, setSortBy, setSortOrder, t, close: closeSort })}
        >
          <span>
            <ToolbarButton title={t('sidebar.explorer.sort')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h12M3 18h6" /></svg>
            </ToolbarButton>
          </span>
        </Dropdown>
      </div>
      <ToolbarButton title={t('sidebar.explorer.newFile')} onClick={createFileWithDialog}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
      </ToolbarButton>
      <ToolbarButton title={t('sidebar.explorer.save')} onClick={saveCurrentFile}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
      </ToolbarButton>
      <div className="stb-sep" />
      <ToolbarButton title={t('sidebar.explorer.openFolder')} onClick={openFolderDialog}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" /></svg>
      </ToolbarButton>
    </div>
  );
}

/**
 * 大纲工具栏：向 `OutlineView` 广播全局展开/折叠事件。
 */
function OutlineToolbar() {
  const { t } = useTranslation();
  return (
    <div className="sidebar__toolbar">
      <span className="sidebar__toolbar-label">{t('sidebar.outline.title')}</span>
      <ToolbarButton
        title={t('sidebar.outline.collapseAll')}
        onClick={() => window.dispatchEvent(new CustomEvent('outline:collapseAll'))}
      >
        <TreeExpansionIcon collapse />
      </ToolbarButton>
      <ToolbarButton
        title={t('sidebar.outline.expandAll')}
        onClick={() => window.dispatchEvent(new CustomEvent('outline:expandAll'))}
      >
        <TreeExpansionIcon />
      </ToolbarButton>
    </div>
  );
}

/**
 * 最近文件工具栏：统计入口与清空列表操作。
 *
 * @param {object} props 组件属性。
 * @param {Function} props.onOpenStats 打开统计面板的回调。
 * @returns {JSX.Element} 最近文件视图工具栏。
 */
function RecentToolbar({ onOpenStats }) {
  const { t } = useTranslation();
  const { clearRecentFiles } = useFileStore();
  return (
    <div className="sidebar__toolbar">
      <span className="sidebar__toolbar-label">{t('sidebar.recent.title')}</span>
      <ToolbarButton title={t('sidebar.explorer.analytics')} onClick={onOpenStats}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
      </ToolbarButton>
      <div className="stb-sep" />
      <ToolbarButton title={t('sidebar.recent.deleteAll')} onClick={clearRecentFiles}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
      </ToolbarButton>
    </div>
  );
}

function RecentList({ onOpenStats }) {
  const { t } = useTranslation();
  const userId = GUEST_USER_SCOPE;
  const recentEntries = useFileStore((s) => s.recentFiles);

  const { openFileFromPath } = useFileManager();
  const recentFiles = useMemo(
    () => getScopedRecentFiles(recentEntries, userId),
    [recentEntries, userId],
  );

  // Recent is presentation-only. Removing an entry must never change a device

  const handleRemove = useCallback(async (e, f) => {
    e.stopPropagation();
    useFileStore.getState().removeRecentFile(f.path);
  }, []);

  const allFiles = recentFiles;
  const sortedFiles = allFiles;

  return (
    <div className="sidebar__view">
      <RecentToolbar onOpenStats={onOpenStats} />
      {sortedFiles.length === 0 ? (
        <MokiStatusEmpty
          title={t('empty.recent.title')}
          hint={t('empty.recent.hint')}
          compact
        />
      ) : (
        <div className="sidebar__recent-list">
          {sortedFiles.map((f) => {
            const isBookmarked = useFileStore.getState().isBookmarked(f.path);
            
            const titleText = f.path;
            return (
              <Tooltip key={f.path} title={titleText} placement="right" mouseEnterDelay={0.5}>
                <div
                  className={cn('sidebar__recent-item', isBookmarked && 'sidebar__recent-item--bookmarked')}
                  onClick={() => openFileFromPath(f.path, f.name)}
                >
                  <span className="sidebar__recent-icon">
                    <FileTypeIcon extension={f.ext} fileName={f.name} />
                    
                  </span>
                  <span className="sidebar__recent-name">{f.name}</span>
                  {isBookmarked && (
                    <Tooltip title={t('tabbar.bookmark')} placement="top" mouseEnterDelay={0.3}>
                      <span className="sidebar__recent-bookmark">
                        <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" width="12" height="12"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                      </span>
                    </Tooltip>
                  )}
                  <Tooltip title={t('sidebar.recent.remove')} placement="top" mouseEnterDelay={0.3}>
                      <span
                        className="sidebar__recent-del"
                        onClick={(e) => handleRemove(e, f)}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                      </span>
                    </Tooltip>
                </div>
              </Tooltip>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * 根据侧边栏页签类型返回对应图标。
 *
 * @param {object} props 组件属性。
 * @param {string} props.id 侧边栏页签标识。
 * @returns {JSX.Element} 对应页签图标。
 */
function SidebarTabIcon({ id }) {
  if (id === 'knowledge') return <span className="sidebar__knowledge-icon"><FileTypeIcon extension="mgtree" size={14} /></span>;
  if (id === 'explorer') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </svg>
    );
  }
  if (id === 'outline') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 6h16" />
        <path d="M4 12h10" />
        <path d="M4 18h7" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 3v6h6" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/**
 * 侧边栏主体。
 *
 * 承载 Explorer / Outline / Recent 三个核心工作流，同时在底部集中提供
 * 用户、主题、更新检查和设置入口。
 */
function Sidebar({ onOpenSettings, onOpenStats }) {
  const { t } = useTranslation();
  const { sidebarVisible, sidebarView, setSidebarView } = useEditorStore();
  const activeTab = useEditorStore((s) => s.tabs.find((tab) => tab.id === s.activeTabId));
  const sidebarWidth = useEditorStore((s) => s.sidebarWidth);
  const sidebarMinWidth = useEditorStore((s) => s.sidebarMinWidth);
  const setSidebarMinWidth = useEditorStore((s) => s.setSidebarMinWidth);
  const source = useEditorBufferContent(activeTab?.id, activeTab?.content || '');
  const isMarkdown = /\.(md|markdown|mdx)$/i.test(activeTab?.name || '');
  const trees = useKnowledgeTrees(activeTab?.path || '', source, isMarkdown);
  const openTreeEditor = useOpenTreeEditor();
  const effectiveView = sidebarView === 'knowledge' && !trees.length ? (isMarkdown ? 'outline' : 'explorer')
    : sidebarView === 'outline' && !isMarkdown ? 'explorer' : sidebarView;
  const { toggleTheme } = useThemeStore();

  const themeButtonRef = useRef(null);
  const checkingUpdate = useUpdateStore((s) => ['checking', 'downloading', 'installing'].includes(s.stage));
  const handleCheckUpdates = () => useUpdateStore.getState().check();
  const [appVersion, setAppVersion] = useState('');

  // 底栏版本号取运行时的实际版本（tauri.conf.json 的 version），
  // 而不是源码里写死的字符串——否则升级后界面仍显示旧号。
  useEffect(() => {
    if (!canCheckUpdates()) return undefined;
    let cancelled = false;
    getVersion()
      .then((version) => { if (!cancelled) setAppVersion(version); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const tabs = [
    { id: 'explorer', label: t('sidebar.tab.explorer'), visible: true },
    { id: 'outline', label: t('sidebar.tab.outline'), visible: isMarkdown },
    { id: 'knowledge', label: t('knowledgeTree.title'), visible: trees.length > 0 },
    { id: 'recent', label: t('sidebar.tab.recent'), visible: true },
  ];

  // 主题切换优先使用 View Transition API 做径向过渡；若运行环境不支持，
  // 则自动回退为直接切换，确保旧环境不受影响。
  /**
   * 在支持时以 View Transition 动画切换主题，否则直接切换。
   *
   * @returns {void}
   */
  function handleThemeSwitch() {
    const element = themeButtonRef.current;
    const rect = element?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth - 48;
    const y = rect ? rect.top + rect.height / 2 : window.innerHeight - 48;
    if (!document.startViewTransition) { toggleTheme(); return; }
    // Ripple out of the toggle. The circle is a CSS keyframe on the View
    // Transition snapshot, so it does not depend on Element.animate()'s
    // pseudo-element support.
    const root = document.documentElement;
    root.style.setProperty('--theme-x', `${x}px`);
    root.style.setProperty('--theme-y', `${y}px`);
    root.dataset.themeTransition = 'ripple';
    const transition = document.startViewTransition(() => { toggleTheme(); });
    transition.finished.finally(() => { delete root.dataset.themeTransition; });
  }

  return (
    <aside className={cn('sidebar', !sidebarVisible && 'sidebar--hidden')} style={{ '--sidebar-width': `${sidebarWidth}px`, '--sidebar-min-width': `${sidebarMinWidth}px` }}>
      <SidebarResizer />
      <div className="sidebar__header">
        {/* 品牌区：应用图标 + 产品字标（蓝边白字「MokiDown」）。
            两者的尺寸都走组件参数——AppMark 会把 --app-mark-size 内联下发，
            在样式表里改同名变量不会生效。间距由 .sidebar__header 的 gap 控制。 */}
        <AppMark size={28} variant="app" className="sidebar__brand-icon" />
        <AppMark size={20} variant="wordmark" className="sidebar__wordmark" />
      </div>

      <SidebarTabs items={tabs} activeId={effectiveView} onChange={setSidebarView} onMinWidthChange={setSidebarMinWidth} renderIcon={SidebarTabIcon} />

      <div key={effectiveView} className="sidebar__content sidebar__content--enter">
        {effectiveView === 'knowledge' && <div className="knowledge-tree__list">
          {trees.map((tree) => <KnowledgeTree key={`${activeTab?.id}:${tree.key}`} source={tree.source}
            onOpen={tree.path ? () => openTreeEditor(tree.path) : undefined}
            title={tree.path?.split(/[\\/]/).pop()} onJump={(language, index) => useEditorStore.getState().requestKnowledgeJump(language, index)} />)}
        </div>}
        {effectiveView === 'explorer' && (
          <div className="sidebar__view">
            <ExplorerToolbar />
            <FileTree />
            <Timeline />
            <PluginPanel />
          </div>
        )}
        {effectiveView === 'outline' && (
          <div className="sidebar__view">
            <OutlineToolbar />
            <OutlineView />
          </div>
        )}
        {effectiveView === 'recent' && (
          <RecentList onOpenStats={onOpenStats} />
        )}
      </div>

      <footer className="sidebar__footer">
        <Tooltip title="GitHub" placement="top">
          <Button type="text" onClick={() => openExternal(REPO_URL)} aria-label="GitHub">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5A12 12 0 0 0 8.2 23.9c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.7-1.3-1.7-1.1-.8.1-.8.1-.8 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.4 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.4-5.5-6A4.7 4.7 0 0 1 5.5 8.5c-.1-.3-.5-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.3 11.3 0 0 1 6 0C17.2 5 18.2 5.3 18.2 5.3c.6 1.6.2 2.9.1 3.2a4.7 4.7 0 0 1 1.2 3.3c0 4.6-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5z" /></svg>
          </Button>
        </Tooltip>
        {}

        {/* 版本号从运行时读，别再写死：写死后升级了界面还显示旧版本，
            而且很容易和 tauri.conf.json 里的真实版本对不上。 */}
        <Tag className="sidebar__version" bordered={false}>{appVersion ? `v${appVersion}` : ''}</Tag>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2, alignItems: 'center' }}>
          <Tooltip title={t('sidebar.footer.themeSwitch')} placement="top" mouseEnterDelay={0.3}>
            <Button
              ref={themeButtonRef}
              type="text"
              className="sidebar__footer-btn"
              onClick={handleThemeSwitch}
              onMouseUp={(event) => event.currentTarget.blur()}
              icon={
                <span className="theme-switch-icons" aria-hidden="true">
                  <svg className="theme-icon theme-icon--sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
                  <svg className="theme-icon theme-icon--moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
                </span>
              }
            />
          </Tooltip>
          <Tooltip title={t('sidebar.footer.checkUpdates')} placement="top" mouseEnterDelay={0.3}>
            <Button
              type="text"
              className="sidebar__footer-btn"
              loading={checkingUpdate}
              onClick={handleCheckUpdates}
              onMouseUp={(event) => event.currentTarget.blur()}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>}
            />
          </Tooltip>
          <Tooltip title={t('sidebar.footer.settings')} placement="top" mouseEnterDelay={0.3}>
            <Button
              type="text"
              className="sidebar__footer-btn"
              onClick={() => onOpenSettings?.()}
              onMouseUp={(event) => event.currentTarget.blur()}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>}
            />
          </Tooltip>
        </div>
      </footer>
    </aside>
  );
}

export default Sidebar;
