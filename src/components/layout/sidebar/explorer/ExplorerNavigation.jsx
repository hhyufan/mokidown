import { useEffect, useRef } from 'react';
import { Tooltip } from 'antd';
import { FontSizeOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import useFileStore from '@store/useFileStore';
import { useFileManager } from '@hooks/useFileManager';
import { parentDirectory } from '@utils/explorerPaths';
import TreeExpansionIcon from '@components/ui/TreeExpansionIcon';
import './explorer-navigation.scss';

export function ExplorerIcon({ name }) {
  const paths = {
    up: 'M12 19V5m-7 7 7-7 7 7',
    refresh: 'M20 4v6h-6M20 10a8 8 0 1 0-1 7',
    folder: 'M3 5h6l2 2h10v13H3Z',
    search: 'm21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    close: 'm6 6 12 12M6 18 18 6',
    previous: 'M12 20V4m-7 7 7-7 7 7',
    next: 'M12 4v16m-7-7 7 7 7-7',
    back: 'M19 12H5m7-7-7 7 7 7',
    forward: 'M5 12h14m-7-7 7 7-7 7',
    expand: 'M8 4h12v12H8ZM4 8v12h12M11 10h6m-3-3v6',
    collapse: 'M8 4h12v12H8ZM4 8v12h12M11 10h6',
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export default function ExplorerNavigation({ search, project = false, busy = false, onParent, onOpenSelected, canOpenSelected, onExpandSelected, onCollapseAll, canExpandSelected, canCollapseAll = true }) {
  const { t } = useTranslation();
  const currentDir = useFileStore((state) => state.currentDir);
  const historyIndex = useFileStore((state) => state.historyIndex);
  const history = useFileStore((state) => state.dirHistory);
  const { loadDirectory, loadFilesOnly, openInExplorer } = useFileManager();
  const navigateHistory = (direction) => {
    const target = history[historyIndex + direction];
    if (!target) return;
    const store = useFileStore.getState();
    if (direction < 0) store.goBack(); else store.goForward();
    void loadFilesOnly(target);
  };
  const parent = parentDirectory(currentDir);
  const input = useRef(null);
  const navigation = useRef(null);
  useEffect(() => {
    const toolbar = navigation.current;
    const explorer = toolbar?.closest('.file-tree');
    if (!explorer) return;
    const handleShortcut = (event) => {
      if (event.defaultPrevented || event.isComposing || !event.altKey ||
          event.ctrlKey || event.metaKey || event.shiftKey ||
          !['ArrowLeft', 'ArrowRight', 'ArrowUp'].includes(event.key) ||
          event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const button = toolbar.querySelector(`button[aria-keyshortcuts="Alt+${event.key}"]:enabled`);
      if (!button) return;
      event.preventDefault();
      button.click();
    };
    explorer.addEventListener('keydown', handleShortcut);
    return () => explorer.removeEventListener('keydown', handleShortcut);
  }, []);
  useEffect(() => { if (search.open) input.current?.focus(); }, [search.open]);
  const button = (label, icon, onClick, disabled = false, extra = {}) => <Tooltip title={label} placement="bottom" mouseEnterDelay={0.3}>
    <button type="button" className={`file-tree__nav-btn${extra.className || ''}`} aria-label={label} disabled={disabled} onClick={onClick} aria-pressed={extra.pressed} aria-expanded={extra.expanded} aria-keyshortcuts={extra.shortcut}>{icon}</button>
  </Tooltip>;
  return <>
    <div ref={navigation} className={`file-tree__nav${project ? ' file-tree__nav--project' : ''}`}>
      {!project && <>
        {button(t('sidebar.explorer.back'), <ExplorerIcon name="back" />, () => navigateHistory(-1), historyIndex <= 0, { shortcut: 'Alt+ArrowLeft' })}
        {button(t('sidebar.explorer.forward'), <ExplorerIcon name="forward" />, () => navigateHistory(1), historyIndex >= history.length - 1, { shortcut: 'Alt+ArrowRight' })}
      </>}
      {button(t('sidebar.explorer.up'), <ExplorerIcon name="up" />, () => onParent ? onParent(parent) : loadDirectory(parent), !parent || busy, { shortcut: 'Alt+ArrowUp' })}
      {project && button(t('sidebar.project.openSelected'), <ExplorerIcon name="next" />, onOpenSelected, !canOpenSelected, { shortcut: 'Alt+ArrowRight' })}
      {project && button(t('sidebar.project.search'), <ExplorerIcon name="search" />, search.toggle, false, { pressed: search.open, expanded: search.open })}
      <div className="file-tree__nav-sep" />
      {button(t('sidebar.explorer.refresh'), <ExplorerIcon name="refresh" />, () => loadDirectory(currentDir))}
      {button(t('sidebar.explorer.openInExplorer'), <ExplorerIcon name="folder" />, () => openInExplorer(currentDir))}
      <div className="file-tree__nav-sep" />
      {onExpandSelected && <>
        {button(t('sidebar.project.expandSelected'), <TreeExpansionIcon />, onExpandSelected, !canExpandSelected)}
        {button(t('sidebar.project.collapseAll'), <TreeExpansionIcon collapse />, onCollapseAll, !canCollapseAll)}
      </>}
      {button(t('sidebar.explorer.closeFolder'), <ExplorerIcon name="close" />, () => useFileStore.getState().clearDirectory(), false, { className: ' file-tree__nav-btn--close' })}
    </div>
    <div className={`explorer-search${search.open ? ' explorer-search--open' : ''}`} inert={!search.open ? '' : undefined} aria-hidden={!search.open}>
      <div className="explorer-search__clip">
        <div className="explorer-search__bar">
          <ExplorerIcon name="search" />
          <input ref={input} aria-label={t('sidebar.project.search')} placeholder={t('sidebar.project.searchPlaceholder')} value={search.query}
            onChange={(event) => search.setQuery(event.target.value)} onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === 'Enter') { event.preventDefault(); search.move(event.shiftKey ? -1 : 1); }
              if (['ArrowUp', 'ArrowDown'].includes(event.key) && search.results.length && !search.loading &&
                  !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
                event.preventDefault();
                search.move(event.key === 'ArrowUp' ? -1 : 1);
              }
              if (event.key === 'Escape') { event.stopPropagation(); search.toggle(); }
            }} />
          <span className="explorer-search__count" role="status" aria-live="polite">{search.loading ? '…' : `${search.results.length ? search.index + 1 : 0}/${search.results.length}${search.truncated ? '+' : ''}`}</span>
          {button(t('sidebar.project.previousMatch'), <ExplorerIcon name="previous" />, () => search.move(-1), !search.results.length || search.loading)}
          {button(t('sidebar.project.nextMatch'), <ExplorerIcon name="next" />, () => search.move(1), !search.results.length || search.loading)}
          {button(t('search.caseSensitive'), <FontSizeOutlined />, () => search.setCaseSensitive(!search.caseSensitive), false, { pressed: search.caseSensitive })}
        </div>
        {search.error && <div className="file-tree__status" role="alert">{search.error}</div>}
        {search.skippedFiles > 0 && <div className="explorer-search__notice">{t('search.skipped', { count: search.skippedFiles })}</div>}
      </div>
    </div>
  </>;
}
