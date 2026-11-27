import FolderOpenIcon from '@components/ui/FolderOpenIcon';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dropdown, Popover, Tooltip } from 'antd';
import {
  BranchesOutlined,
  CheckOutlined,
  CloseOutlined,
  FileTextOutlined,
  GithubOutlined,
} from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import useConfigStore from '@store/useConfigStore';
import useEditorStore from '@store/useEditorStore';
import useHistoryStore from '@store/useHistoryStore';
import useNotificationStore from '@store/useNotificationStore';
import { useFileManager } from '@hooks/useFileManager';
import FileTypeIcon from '@components/ui/FileTypeIcon';
import MarkdownIcon from '@components/ui/MarkdownIcon';
import MokiStatusEmpty from '@components/moki/MokiStatusEmpty';
import { ExplorerIcon } from './explorer/ExplorerNavigation';
import './explorer/file-tree.scss';
import ChevronIcon from '@components/ui/ChevronIcon';
import { fileName, filePath } from '@utils/gitHistory';
import { textSearchRange } from '@utils/searchMatching';
import { openEditorLink } from '@utils/editorLinks';
import { isMarkdownPath, prepareComparisonRenderer } from '@utils/editorRendererBoot';
import {
  onDirectoryChanged,
  onFileChanged,
  startDirectoryWatching,
  stopDirectoryWatching,
} from '@utils/tauriApi';
import './workspace-changes.scss';

// 仓库状态缓存：切回变动面板时先显示上次结果，再后台刷新，不再闪加载中。
const statusCache = new Map();
const statusKey = (directory, gitPath) => `${directory}\u0000${gitPath}`;

const errors = new Set([
  'gitNotFound',
  'gitPathMustBeAbsolute',
  'invalidBranch',
  'invalidGitPath',
  'changeMissing',
  'comparisonTooLarge',
  'too-large',
  'binary',
  'invalid-encoding',
  'saveBeforeSwitch',
]);

const statusName = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'typeChanged',
  '?': 'untracked',
  U: 'conflict',
};

const statusMark = {
  A: 'M5 8h6M8 5v6',
  '?': 'M5 8h6M8 5v6',
  D: 'M5 8h6',
  R: 'M5 8h6M9 6l2 2-2 2',
  C: 'M5 8h6M8 5v6',
  T: 'M5 8h6M9 6l2 2-2 2',
  U: 'M8 5v3.5m0 2v.25',
};

function Highlight({ text, query }) {
  const value = query.trim();
  const match = value ? textSearchRange(text, value, false) : null;
  if (!match) return text;
  return (
    <>
      {text.slice(0, match.start)}
      <mark>{text.slice(match.start, match.start + match.length)}</mark>
      {text.slice(match.start + match.length)}
    </>
  );
}

function ChangeStatus({ code, label }) {
  return (
    <Tooltip title={label} placement="top">
      <span className="workspace-changes__status" data-code={code}>
        <svg
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="2" width="12" height="12" rx="2" />
          {statusMark[code] ? (
            <path d={statusMark[code]} />
          ) : (
            <circle cx="8" cy="8" r="1.7" fill="currentColor" stroke="none" />
          )}
        </svg>
      </span>
    </Tooltip>
  );
}

const navButton = (label, icon, onClick, extra = {}) => (
  <Tooltip title={label} placement="bottom" mouseEnterDelay={0.3}>
    <button
      type="button"
      className="file-tree__nav-btn"
      aria-label={label}
      onClick={onClick}
      {...extra}
    >
      {icon}
    </button>
  </Tooltip>
);

function BranchSwitcher({ repository, onSwitch, busy }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const branches = repository.branches || [];
  return (
    <Popover
      trigger="click"
      placement="bottomLeft"
      arrow={false}
      classNames={{ root: 'workspace-compare-popup' }}
      open={open}
      onOpenChange={setOpen}
      content={
        <div className="workspace-changes__branch-menu">
          <div className="workspace-changes__branch-group" role="separator">
            {t('workspaceDiff.localBranches')}
          </div>
          {branches.map((branch) => (
            <button
              key={branch}
              type="button"
              className="workspace-changes__branch-option"
              disabled={busy || branch === repository.branch}
              onClick={() => {
                setOpen(false);
                void onSwitch(branch, false);
              }}
            >
              {branch === repository.branch ? <CheckOutlined /> : <BranchesOutlined />}
              <span>{branch}</span>
            </button>
          ))}
        </div>
      }
    >
      <Tooltip title={t('workspaceDiff.switchBranch')} placement="bottom" mouseEnterDelay={0.3}>
        <button
          type="button"
          className="workspace-changes__branch-toggle"
          aria-label={t('workspaceDiff.switchBranch')}
          aria-expanded={open}
        >
          <ChevronIcon className="workspace-changes__chevron" />
          <BranchesOutlined />
          <span>{repository.branch || t('workspaceDiff.detached')}</span>
        </button>
      </Tooltip>
    </Popover>
  );
}

export default function WorkspaceChanges({ directory }) {
  const { t } = useTranslation();
  const gitPath = useConfigStore((state) => state.gitExecutablePath);
  const markdownOnlySetting = useConfigStore((state) => state.gitChangesMarkdownOnly);
  const { openInExplorer, openFileFromPath } = useFileManager();
  const [refresh, setRefresh] = useState(0);
  const [status, setStatus] = useState(
    () => statusCache.get(statusKey(directory, gitPath)) ?? null,
  );
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedChange, setSelectedChange] = useState('');
  const activeTabId = useEditorStore((state) => state.activeTabId);
  const activeDiff = useHistoryStore((state) => state.diff);
  const listRef = useRef(null);
  const indicatorRef = useRef(null);
  const previousIndicator = useRef(null);
  const [collapsedLayers, setCollapsedLayers] = useState({});
  const [comparing, setComparing] = useState(false);
  // 面板内临时状态：初始跟随设置，按钮只改这一份。
  const [markdownOnly, setMarkdownOnly] = useState(markdownOnlySetting);
  const [searchOpen, setSearchOpen] = useState(false);
  const comparisonRequest = useRef(0);
  const cancelComparison = useCallback(() => {
    comparisonRequest.current++;
  }, []);
  const switchInProgress = useRef(false);
  const currentStatus =
    status?.directory === directory && status?.gitPath === gitPath ? status : null;
  const repository = currentStatus?.result?.repository;
  const root = repository?.root;
  // 与文件树的 CurrentFileIndicator 同一套动画：
  // 出现时 scaleY(0)→1 + 淡入，切换行时平移，取消选中时 scaleY→0 淡出。
  useLayoutEffect(() => {
    const marker = indicatorRef.current;
    const list = listRef.current;
    if (!marker) return;
    const row = list?.querySelector('.workspace-changes__file[data-selected="true"]');
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const easing = 'cubic-bezier(0.2, 0.75, 0.25, 1)';
    const animations = marker.getAnimations?.() ?? [];
    animations.forEach((animation) => animation.cancel());
    if (!marker.animate) {
      marker.style.opacity = '0';
      return;
    }
    const old = previousIndicator.current;
    if (!list || !row) {
      previousIndicator.current = null;
      if (!old || reduced) {
        marker.style.opacity = '0';
        return;
      }
      marker.animate(
        [
          { transform: `translateY(${old.top}px) scaleY(1)`, opacity: 1 },
          { transform: `translateY(${old.top}px) scaleY(0)`, opacity: 0 },
        ],
        { duration: 170, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'both' },
      );
      return;
    }
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const top = rowRect.top - listRect.top + list.scrollTop + (rowRect.height - 14) / 2;
    previousIndicator.current = { top };
    if (reduced) {
      marker.style.transform = `translateY(${top}px) scaleY(1)`;
      marker.style.opacity = '1';
      return;
    }
    if (!old) {
      marker.animate(
        [
          { transform: `translateY(${top}px) scaleY(0)`, opacity: 0 },
          { transform: `translateY(${top}px) scaleY(1)`, opacity: 1 },
        ],
        { duration: 190, easing, fill: 'both' },
      );
    } else if (old.top !== top) {
      marker.animate(
        [
          { transform: `translateY(${old.top}px) scaleY(1)`, opacity: 1 },
          { transform: `translateY(${top}px) scaleY(1)`, opacity: 1 },
        ],
        { duration: 210, easing, fill: 'both' },
      );
    } else {
      marker.style.transform = `translateY(${top}px) scaleY(1)`;
      marker.style.opacity = '1';
    }
  }, [selectedChange, repository, collapsedLayers, busy, markdownOnly, query]);

  // 选中态由当前激活的对比标签推导：切到普通标签时取消高亮，
  // 切到任意 git 修改的对比标签时自动定位到对应行。
  useEffect(() => {
    const gitEdit =
      activeDiff && activeDiff.tabId === activeTabId ? activeDiff.external?.gitEdit : null;
    setSelectedChange(gitEdit?.layer && gitEdit?.path ? `${gitEdit.layer}:${gitEdit.path}` : '');
  }, [activeDiff, activeTabId]);

  useEffect(() => {
    const key = statusKey(directory, gitPath);
    const cached = statusCache.get(key);
    if (cached) setStatus(cached);
    else setStatus(null);
    let active = true;
    invoke('git_workspace_status', { directory, gitPath }).then(
      (result) => {
        if (!active) return;
        const next = { directory, gitPath, result };
        statusCache.set(key, next);
        setStatus(next);
      },
      (failure) => {
        if (!active) return;
        const next = { directory, gitPath, error: String(failure) };
        statusCache.set(key, next);
        setStatus(next);
      },
    );
    return () => {
      active = false;
    };
  }, [directory, gitPath, refresh]);

  useEffect(() => {
    const reload = () => setRefresh((value) => value + 1);
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, []);

  useEffect(() => {
    const repositoryRoot = repository?.root;
    if (!repositoryRoot) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setRefresh((value) => value + 1);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [repository?.root]);

  useEffect(() => {
    const repositoryRoot = repository?.root;
    if (!repositoryRoot) return undefined;
    const root = repositoryRoot.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setRefresh((value) => value + 1), 400);
    };
    const inside = (value) => {
      const path = String(value || '')
        .replaceAll('\\', '/')
        .toLowerCase();
      return path === root || path.startsWith(`${root}/`);
    };
    const stops = [];
    onFileChanged((payload) => {
      if (inside(payload?.path)) schedule();
    })
      .then((stop) => stops.push(stop))
      .catch(() => {});
    onDirectoryChanged((payload) => {
      if (inside(payload?.dir)) schedule();
    })
      .then((stop) => stops.push(stop))
      .catch(() => {});
    void startDirectoryWatching(repositoryRoot).catch(() => {});
    return () => {
      window.clearTimeout(timer);
      void stopDirectoryWatching(repositoryRoot).catch(() => {});
      for (const stop of stops) stop?.();
    };
  }, [repository?.root]);

  useEffect(() => {
    setComparing(false);
    setSelectedChange('');
    return cancelComparison;
  }, [cancelComparison, directory, gitPath]);

  const describeError = useCallback(
    (failure) => {
      const code = failure?.kind ?? failure?.message ?? String(failure);
      return errors.has(code) ? t(`workspaceDiff.errors.${code}`) : code || t('editor.loadFailed');
    },
    [t],
  );
  const notify = useNotificationStore((state) => state.notify);
  const reportError = useCallback(
    (failure) => {
      notify('error', t('notification.error'), describeError(failure));
    },
    [describeError, notify, t],
  );
  const notifiedErrorRef = useRef('');
  useEffect(() => {
    const failure = currentStatus?.error;
    if (!failure) return;
    const message = describeError(failure);
    if (message === notifiedErrorRef.current) return;
    notifiedErrorRef.current = message;
    notify('error', t('notification.error'), message);
  }, [currentStatus?.error, describeError, notify, t]);
  const update = () => {
    setRefresh((value) => value + 1);
  };

  const switchBranch = async (name, create) => {
    if (switchInProgress.current || !repository) return false;
    const normalized = (path) => {
      const value = path.replaceAll('\\', '/').replace(/\/$/, '');
      return /^[a-z]:/i.test(value) ? value.toLowerCase() : value;
    };
    const rootPath = normalized(repository.root) + '/';
    if (
      useEditorStore
        .getState()
        .tabs.some((tab) => tab.modified && tab.path && normalized(tab.path).startsWith(rootPath))
    ) {
      reportError('saveBeforeSwitch');
      return false;
    }
    switchInProgress.current = true;
    cancelComparison();
    setComparing(false);
    setBusy(true);
    try {
      await invoke('git_workspace_switch', { directory: repository.root, gitPath, name, create });
      const diff = useHistoryStore.getState().diff;
      if (diff?.external?.repository === repository.root)
        useHistoryStore.getState().clearDiff(diff);
      update();
      return true;
    } catch (failure) {
      reportError(failure);
      return false;
    } finally {
      switchInProgress.current = false;
      setBusy(false);
    }
  };

  const runComparison = async (read) => {
    const request = ++comparisonRequest.current;
    const tabId = useEditorStore.getState().activeTabId;
    setComparing(true);
    try {
      const { original, external, label } = await read();
      if (request === comparisonRequest.current) {
        useHistoryStore.getState().openFileComparison(tabId, original, external, label);
      }
    } catch (failure) {
      if (request === comparisonRequest.current) reportError(failure);
    } finally {
      if (request === comparisonRequest.current) setComparing(false);
    }
  };

  const compareChange = (change) => {
    const { root: repositoryRoot } = repository;
    const originalPath = change.oldPath || change.path;
    prepareComparisonRenderer([originalPath, change.path].every(isMarkdownPath));
    void runComparison(async () => {
      const { original, modified } = await invoke('git_workspace_diff', {
        directory: repositoryRoot,
        gitPath,
        path: change.path,
        layer: change.layer,
      });
      const staged = change.layer === 'index';
      return {
        original,
        label: change.path,
        external: {
          repository: repositoryRoot,
          modified,
          gitEdit: {
            gitPath,
            path: change.path,
            layer: change.layer,
            expectedMissing: change.code === 'D',
          },
          onGitApplied: update,
          originalPath: filePath(repositoryRoot, originalPath),
          modifiedPath: filePath(repositoryRoot, change.path),
          originalName: fileName(originalPath),
          modifiedName: fileName(change.path),
          originalLabel: staged || change.code === 'U' ? 'HEAD' : t('workspaceDiff.index'),
          modifiedLabel: t(staged ? 'workspaceDiff.index' : 'workspaceDiff.worktree'),
        },
      };
    });
  };

  const normalizedQuery = query.trim().toLowerCase();
  // 按文件修改时间细粒度连接；同一时间按路径稳定排序。
  const list = [...(repository?.changes ?? [])]
    .sort(
      (left, right) =>
        (right.mtime || 0) - (left.mtime || 0) || left.path.localeCompare(right.path),
    )
    .filter(({ path, oldPath }) => {
      if (markdownOnly && !/\.(?:md|markdown|mdx)$/i.test(path)) return false;
      return `${path} ${oldPath || ''}`.toLowerCase().includes(normalizedQuery);
    });

  const stepChange = (step) => {
    if (!list.length) return;
    const current = list.findIndex((change) => `${change.layer}:${change.path}` === selectedChange);
    const index =
      current < 0 ? (step > 0 ? 0 : list.length - 1) : (current + step + list.length) % list.length;
    const change = list[index];
    if (change) compareChange(change);
  };

  const renderChange = (change) => {
    const key = `${change.layer}:${change.path}`;
    const name = fileName(change.path);
    const folder = change.path.slice(0, Math.max(0, change.path.lastIndexOf('/')));
    const path = filePath(root, change.path);
    const title = change.oldPath ? `${change.oldPath} → ${change.path}` : change.path;
    const statusLabel = t(`workspaceDiff.status.${statusName[change.code] || 'modified'}`);
    return (
      <Dropdown
        key={key}
        trigger={['contextMenu']}
        menu={{
          items: [
            {
              key: 'open',
              icon: <FileTextOutlined />,
              label: t('workspaceDiff.openFile'),
              disabled: change.code === 'D',
              onClick: () => {
                const diff = useHistoryStore.getState().diff;
                if (diff?.external) useHistoryStore.getState().clearDiff(diff);
                void openFileFromPath(path, name);
              },
            },
            {
              key: 'reveal',
              icon: <FolderOpenIcon />,
              label: t('workspaceDiff.reveal'),
              onClick: () => {
                void openInExplorer(
                  change.code === 'D' ? (folder ? filePath(root, folder) : root) : path,
                );
              },
            },
          ],
        }}
      >
        <Tooltip title={title} placement="top">
          <button
            type="button"
            className="workspace-changes__file workspace-changes__row"
            data-selected={selectedChange === key}
            disabled={busy}
            aria-pressed={selectedChange === key}
            aria-label={`${title} · ${statusLabel}`}
            onClick={() => compareChange(change)}
          >
            <FileTypeIcon fileName={name} size={18} />
            <span className="workspace-changes__name">
              <span>
                <Highlight text={name} query={query} />
              </span>
              {folder && (
                <span className="workspace-changes__breadcrumb">
                  {folder
                    .split('/')
                    .filter(Boolean)
                    .map((part, index, parts) => (
                      <span className="workspace-changes__crumb" key={`${part}-${index}`}>
                        <Highlight text={part} query={query} />
                        {index < parts.length - 1 && (
                          <ChevronIcon className="workspace-changes__crumb-sep" />
                        )}
                      </span>
                    ))}
                </span>
              )}
            </span>
            <ChangeStatus code={change.code} label={statusLabel} />
          </button>
        </Tooltip>
      </Dropdown>
    );
  };

  return (
    <section className="sidebar__view workspace-changes">
      <div className="sidebar__toolbar">
        <span className="sidebar__toolbar-label">
          {t('workspaceDiff.tab')}
          {list.length > 0 && <span className="workspace-changes__total">{list.length}</span>}
        </span>
      </div>
      <div className="file-tree__nav workspace-changes__nav">
        {navButton(
          t('workspaceDiff.previous'),
          <ExplorerIcon name="previous" />,
          () => stepChange(-1),
          {
            disabled: !list.length,
          },
        )}
        {navButton(t('workspaceDiff.next'), <ExplorerIcon name="next" />, () => stepChange(1), {
          disabled: !list.length,
        })}
        {navButton(
          t('workspaceDiff.filterFiles'),
          <ExplorerIcon name="search" />,
          () => setSearchOpen((open) => !open),
          { 'aria-pressed': searchOpen, 'aria-expanded': searchOpen },
        )}
        <span className="file-tree__nav-sep" />
        {navButton(t('workspaceDiff.refresh'), <ExplorerIcon name="refresh" />, update, {
          disabled: busy,
        })}
        {navButton(
          t(markdownOnly ? 'workspaceDiff.markdownOnly' : 'workspaceDiff.allFiles'),
          <MarkdownIcon />,
          () => setMarkdownOnly((value) => !value),
          { 'aria-pressed': markdownOnly },
        )}
        {repository?.github && (
          <>
            <span className="file-tree__nav-sep" />
            {navButton(t('workspaceDiff.openOnGitHub'), <GithubOutlined />, () => {
              void openEditorLink(repository.github, { browserFallback: true });
            })}
          </>
        )}
      </div>
      <div
        className={`workspace-changes__search${searchOpen ? ' workspace-changes__search--open' : ''}`}
        inert={!searchOpen ? '' : undefined}
        aria-hidden={!searchOpen}
      >
        <div className="workspace-changes__search-clip">
          <div className="workspace-changes__search-bar">
            <ExplorerIcon name="search" />
            <input
              autoFocus={searchOpen}
              value={query}
              aria-label={t('workspaceDiff.filterFiles')}
              placeholder={t('workspaceDiff.filterFiles')}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <Tooltip title={t('search.clear')} placement="bottom" mouseEnterDelay={0.3}>
                <button type="button" aria-label={t('search.clear')} onClick={() => setQuery('')}>
                  <CloseOutlined />
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
      {repository ? (
        <>
          <div className="workspace-changes__controls">
            <BranchSwitcher repository={repository} onSwitch={switchBranch} busy={busy} />
            <Tooltip title={repository.root} placement="top">
              <span className="workspace-changes__repository">
                <FileTypeIcon fileName={fileName(repository.root)} isFolder size={16} />
                <span className="workspace-changes__hint">{fileName(repository.root)}</span>
              </span>
            </Tooltip>
          </div>
          <div className="workspace-changes__list" ref={listRef} aria-busy={busy || comparing}>
            <span ref={indicatorRef} className="workspace-changes__indicator" aria-hidden="true" />
            {(() => {
              const staged = list.filter((change) => change.layer === 'index');
              const unstaged = list.filter((change) => change.layer === 'worktree');
              const expanded = !collapsedLayers.index;
              return (
                <>
                  {staged.length > 0 && (
                    <section className="workspace-changes__group" data-expanded={expanded}>
                      <button
                        type="button"
                        className="workspace-changes__group-toggle"
                        aria-expanded={expanded}
                        aria-controls="workspace-changes-index"
                        onClick={() =>
                          setCollapsedLayers((state) => ({ ...state, index: expanded }))
                        }
                      >
                        <ChevronIcon className="workspace-changes__chevron" />
                        <span>{t('workspaceDiff.index')}</span>
                        <span className="workspace-changes__count">{staged.length}</span>
                      </button>
                      <div
                        id="workspace-changes-index"
                        className="workspace-changes__drawer"
                        inert={expanded ? undefined : ''}
                      >
                        <div className="workspace-changes__drawer-content">
                          {staged.map(renderChange)}
                        </div>
                      </div>
                    </section>
                  )}
                  {unstaged.length > 0 && (
                    <div className="workspace-changes__worktree">{unstaged.map(renderChange)}</div>
                  )}
                </>
              );
            })()}
            {!list.length &&
              (normalizedQuery ? (
                <p className="workspace-changes__hint">{t('workspaceDiff.noMatches')}</p>
              ) : comparing ? null : (
                <MokiStatusEmpty title={t('empty.changes.title')} hint={t('empty.changes.hint')} />
              ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
