/**
 * @file 资源管理器文件树模块。
 *
 * 该文件负责展示当前目录的文件树、面包屑导航与行内新建文件流程，并承接
 * Explorer 视图中的目录切换、删除与快速打开等交互。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';
import DeleteFileModal from '@components/overlays/DeleteFileModal';
import useFileStore from '@store/useFileStore';
import useEditorStore from '@store/useEditorStore';
import { useFileManager } from '@hooks/useFileManager';
import { useHorizontalDragScroll } from '@hooks/useHorizontalDragScroll';
import useExplorerDeletion from '@hooks/useExplorerDeletion';
import ExplorerDeleteButton from './ExplorerDeleteButton';

import { cn } from '@utils/classNames';
import MokiStatusEmpty from '@components/moki/MokiStatusEmpty';
import FileTypeIcon from '@components/ui/FileTypeIcon';
import usePluginContributions from '@store/usePluginContributions';
import ChevronIcon from '@components/ui/ChevronIcon';
import { isSafUri, safDisplayName } from '@utils/tauriApi';
import FileNameField, { splitFileName, DEFAULT_FILE_EXTENSION } from './FileNameField';
import VirtualFileList from './VirtualFileList';
import { sortDirectoryContents } from '@utils/directoryContents';
import ExplorerEntryIcon from './ExplorerEntryIcon';
import ExplorerNavigation from './ExplorerNavigation';
import useExplorerSearch from '@hooks/useExplorerSearch';
import { locateDirectoryEntry } from '@utils/tauriApi';
import ExplorerMatchName from './ExplorerMatchName';
import { ensureDirectoryRange, getIndexedFile } from '@/services/workspaceFiles';
import './file-tree.scss';

function FileRowTooltip({ defer, children, ...props }) {
  return defer ? children : <Tooltip {...props}>{children}</Tooltip>;
}

/**
 * 根据面包屑索引重建可跳转的目录路径。
 *
 * @param {string} currentDir 当前目录绝对路径。
 * @param {number} index 目标面包屑片段索引。
 * @returns {string} 对应片段代表的目录路径。
 */
function buildBreadcrumbPath(currentDir, index) {
  if (!currentDir) return '';
  const normalized = currentDir.replace(/[\\/]+$/, '');
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  if (parts.length === 0) return '';

  const isWindowsDrive = /^[A-Z]:$/i.test(parts[0]);
  if (isWindowsDrive) {
    if (index <= 0) return `${parts[0]}\\`;
    return `${parts[0]}\\${parts.slice(1, index + 1).join('\\')}`;
  }
  // The browser demo mounts its picked directory as web://<folder>/<sub>.
  // Rebuild those paths without the leading slash that normal absolute paths use.
  if (parts[0] === 'web:') {
    if (index <= 0) return 'web:';
    return `web://${parts.slice(1, index + 1).join('/')}`;
  }
  return `/${parts.slice(0, index + 1).join('/')}`;
}

/**
 * 资源管理器文件树。
 *
 * 负责目录导航、面包屑滚动、文件排序、新建文件入口，以及目录项点击与删除等
 * 资源管理器层交互。
 */
function FileTree() {
  const { t } = useTranslation();
  const files = useFileStore((s) => s.files);
  const directoryIndex = useFileStore((s) => s.directoryIndex);
  const directoryLoading = useFileStore((s) => s.directoryLoading);
  const directoryError = useFileStore((s) => s.directoryError);
  const fileBadges = usePluginContributions((s) => s.fileBadges);
  const currentDir = useFileStore((s) => s.currentDir);
  const sortBy = useFileStore((s) => s.sortBy);
  const sortOrder = useFileStore((s) => s.sortOrder);
  const activeTabId = useEditorStore((s) => s.activeTabId);

  const {
    loadDirectory,
    openFileFromPath,
    createFileInCurrentDir,
    renameEntry,
  } = useFileManager();

  const [creatingFileName, setCreatingFileName] = useState('');
  const [creatingFileExt, setCreatingFileExt] = useState(DEFAULT_FILE_EXTENSION);
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  // 行内重命名：记录正在改的那一项，以及拆开的主名与后缀
  // （拆开是为了复用与新建完全相同的输入行——那里主名与后缀是两个控件）。
  const [renamingPath, setRenamingPath] = useState(null);
  const [renamingEntry, setRenamingEntry] = useState(null);
  const [renamingStem, setRenamingStem] = useState('');
  const [renamingExt, setRenamingExt] = useState('');
  const [breadcrumbExpanded, setBreadcrumbExpanded] = useState(false);
  const deletion = useExplorerDeletion(() => {
    if (useFileStore.getState().currentDir === currentDir) return loadDirectory(currentDir);
  });
  const bcScrollRef = useRef(null);
  const bcThumbRef = useRef(null);

  // 面包屑横向滚动与自定义滚动条联动。
  /**
   * 按当前滚动范围更新面包屑滚动条滑块的尺寸与位置。
   *
   * @returns {void}
   */
  const updateBcScrollbar = useCallback(() => {
    const el = bcScrollRef.current;
    const thumb = bcThumbRef.current;
    if (!el || !thumb) return;
    const ratio = el.clientWidth / el.scrollWidth;
    if (ratio >= 1) {
      thumb.style.display = 'none';
    } else {
      thumb.style.display = 'block';
      thumb.style.width = `${ratio * 100}%`;
      thumb.style.left = `${(el.scrollLeft / el.scrollWidth) * 100}%`;
    }
  }, []);

  const { onThumbMouseDown: bcOnThumbMouseDown } = useHorizontalDragScroll(bcScrollRef, updateBcScrollbar);

  useEffect(() => {
    const el = bcScrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateBcScrollbar, { passive: true });
    // React 合成事件里的 `onWheel` 默认是被动监听，调用 `preventDefault()`
    // 会报警告；这里改挂原生非被动监听，把纵向滚轮转成面包屑横向滚动。
    const onWheel = (e) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
      updateBcScrollbar();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    const ro = new ResizeObserver(updateBcScrollbar);
    ro.observe(el);
    updateBcScrollbar();
    return () => {
      el.removeEventListener('scroll', updateBcScrollbar);
      el.removeEventListener('wheel', onWheel);
      ro.disconnect();
    };
  }, [updateBcScrollbar, currentDir]);

  // 路径变化后自动滚到尾部，优先露出当前所在的最深层目录。
  useEffect(() => {
    const el = bcScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollLeft = el.scrollWidth;
      updateBcScrollbar();
    });
  }, [currentDir, updateBcScrollbar]);

  const currentDirIsSaf = isSafUri(currentDir);

  // 行内新建文件流程。
  /**
   * 启动行内新建文件流程并展示输入框。
   *
   * @returns {void}
   */
  const startCreatingFile = useCallback(() => {
    if (!currentDir) return;
    setCreatingFileName('');
    // 每次新建都回到默认后缀，免得上一次的 .json 之类残留下来让人意外。
    setCreatingFileExt(DEFAULT_FILE_EXTENSION);
    setIsCreatingFile(true);
  }, [currentDir]);

  /**
   * 取消行内新建文件流程并恢复初始状态。
   *
   * @returns {void}
   */
  const cancelCreatingFile = useCallback(() => {
    setCreatingFileName('');
    setIsCreatingFile(false);
  }, []);

  /**
   * 把输入的名字与后缀拼成完整文件名。
   *
   * 用户可能连后缀一起敲了（note.md），这时不再补后缀，避免出现 note.md.md。
   *
   * @returns {string} 完整文件名；名字为空时返回空串。
   */
  const composeFileName = useCallback(() => {
    const stem = creatingFileName.trim();
    if (!stem) return '';
    const rawExt = creatingFileExt.trim();
    if (!rawExt) return stem;
    return `${stem}${rawExt.startsWith('.') ? rawExt : `.${rawExt}`}`;
  }, [creatingFileName, creatingFileExt]);

  /**
   * 提交当前输入的文件名，并在创建成功后关闭输入态。
   *
   * @returns {Promise<void>}
   */
  const commitCreatingFile = useCallback(async () => {
    const fileName = composeFileName();
    if (!fileName) {
      cancelCreatingFile();
      return;
    }
    const result = await createFileInCurrentDir(fileName);
    if (result?.ok) cancelCreatingFile();
  }, [cancelCreatingFile, composeFileName, createFileInCurrentDir]);

  /**
   * 进入行内重命名态。
   *
   * @param {object} file 目标文件或目录。
   * @param {Event} [event] 触发事件，用于拦住冒泡（否则会顺带打开文件）。
   * @returns {void}
   */
  const startRenaming = useCallback((file, event, index) => {
    event?.stopPropagation();
    // 双击会先触发两次单击，其中一次可能已经把文件打开了；这里只关心进入编辑态。
    const { stem, extension } = splitFileName(file.name);
    setRenamingPath(file.path);
    setRenamingEntry({ file, index });
    setRenamingStem(stem);
    setRenamingExt(extension);
  }, []);

  /**
   * 退出重命名态并丢弃草稿。
   *
   * @returns {void}
   */
  const cancelRenaming = useCallback(() => {
    setRenamingPath(null);
    setRenamingEntry(null);
    setRenamingStem('');
    setRenamingExt('');
  }, []);

  /**
   * 提交重命名。
   *
   * @returns {Promise<void>}
   */
  const commitRenaming = useCallback(async () => {
    if (!renamingPath) return;
    const nextName = `${renamingStem}${renamingExt}`.trim();
    if (!nextName) { cancelRenaming(); return; }
    const result = await renameEntry(renamingPath, nextName);
    if (result?.ok) cancelRenaming();
  }, [cancelRenaming, renameEntry, renamingExt, renamingPath, renamingStem]);

  useEffect(() => {
    const handler = () => startCreatingFile();
    window.addEventListener('explorer:newFileRequest', handler);
    return () => window.removeEventListener('explorer:newFileRequest', handler);
  }, [startCreatingFile]);

  // 切换目录时重置新建文件状态，并恢复面包屑折叠态。
  useEffect(() => {
    cancelCreatingFile();
    cancelRenaming();
    setBreadcrumbExpanded(false);
  }, [currentDir]); // eslint-disable-line react-hooks/exhaustive-deps

  // 文件与目录排序规则：目录优先，其次按用户选择字段排序。
  const snapshotId = directoryIndex?.id;
  const sortedFiles = useMemo(() => snapshotId ? [] : sortDirectoryContents(files, { sortBy, sortOrder }),
    [snapshotId, files, sortBy, sortOrder]);

  const [scrollTarget, setScrollTarget] = useState(null);

  // Keep the new-file footer visible when creation starts.
  useEffect(() => {
    if (isCreatingFile) setScrollTarget({ index: sortedFiles.length, align: 'end' });
  }, [isCreatingFile, sortedFiles.length]);
  const [searchPath, setSearchPath] = useState('');
  const search = useExplorerSearch({ root: directoryLoading ? '' : currentDir, recursive: false, version: snapshotId || files,
    onMatch: async (file, isCurrent) => {
      const index = directoryIndex ? await locateDirectoryEntry(directoryIndex.id, file.path)
        : sortedFiles.findIndex((entry) => entry.path === file.path);
      if (index == null || index < 0 || !isCurrent()) return;
      setSearchPath(file.path); setScrollTarget({ index });
    },
  });

  // 面包屑展示数据。
  const breadcrumbParts = currentDir
    ? (currentDirIsSaf ? [safDisplayName(currentDir)] : currentDir.split(/[\\/]/).filter(Boolean))
    : [];
  const shouldCollapse = breadcrumbParts.length > 3 && !breadcrumbExpanded;

  // New-file input row: rendered as the virtual list footer so it follows the
  // last file instead of floating at the bottom of the panel.
  const creatingRow = isCreatingFile ? (
    <div className="file-tree__item file-tree__item--creating">
      <span className="file-tree__item-icon">
        <FileTypeIcon
          extension={creatingFileExt.replace(/^\./, '') || 'md'}
          fileName={`${creatingFileName || 'untitled'}${creatingFileExt}`}
        />
      </span>
      <FileNameField
        stem={creatingFileName}
        extension={creatingFileExt}
        onStemChange={setCreatingFileName}
        onExtensionChange={setCreatingFileExt}
        onCommit={commitCreatingFile}
        onCancel={cancelCreatingFile}
        placeholder={t('sidebar.explorer.newFilePlaceholder')}
        autoFocus
      />
    </div>
  ) : null;

  // 未打开目录时显示空状态占位。
  if (!currentDir) {
    return (
      <MokiStatusEmpty title={t('empty.files.title')} hint={t('empty.files.hint')} />
    );
  }

  return (
    <div className="file-tree">
      <ExplorerNavigation search={search} />

      {/* 目录面包屑：支持折叠展示、横向滚动与快速跳转。 */}
      <div className="file-tree__breadcrumb">
        <svg
          className="file-tree__breadcrumb-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>

        <div className="file-tree__breadcrumb-scroll-wrap">
          <div
            className="file-tree__breadcrumb-scroll"
            ref={bcScrollRef}
          >
            {shouldCollapse ? (
              /* 折叠态只保留首层、省略号与当前叶子目录。 */
              <>
                <span className="file-tree__breadcrumb-item">
                  <span
                    className="file-tree__breadcrumb-part"
                    onClick={() => loadDirectory(buildBreadcrumbPath(currentDir, 0))}
                  >
                    {breadcrumbParts[0]}
                  </span>
                </span>
                <span className="file-tree__breadcrumb-item">
                  <ChevronIcon className="file-tree__breadcrumb-chevron" style={{ color: 'var(--accent)', opacity: 0.7 }} />
                  <Tooltip title={t('sidebar.explorer.expandBreadcrumb')} placement="bottom" mouseEnterDelay={0.3}>
                    <span
                      className="file-tree__breadcrumb-ellipsis"
                      onClick={() => setBreadcrumbExpanded(true)}
                    >
                      …
                    </span>
                  </Tooltip>
                </span>
                <span className="file-tree__breadcrumb-item">
                  <ChevronIcon className="file-tree__breadcrumb-chevron" style={{ color: 'var(--accent)', opacity: 0.7 }} />
                  <span
                    className="file-tree__breadcrumb-part"
                    onClick={() => loadDirectory(currentDir)}
                  >
                    {breadcrumbParts[breadcrumbParts.length - 1]}
                  </span>
                </span>
              </>
            ) : (
              /* 展开态显示全部目录段，并允许横向滚动。 */
              breadcrumbParts.map((part, i) => (
                <span key={i} className="file-tree__breadcrumb-item">
                  {i > 0 && (
                    <ChevronIcon className="file-tree__breadcrumb-chevron" style={{ color: 'var(--accent)', opacity: 0.7 }} />
                  )}
                  <span
                    className="file-tree__breadcrumb-part"
                    onClick={() => loadDirectory(currentDirIsSaf ? currentDir : buildBreadcrumbPath(currentDir, i))}
                  >
                    {part}
                  </span>
                </span>
              ))
            )}
          </div>

          {/* 自定义横向滚动条，路径较长或展开时更易操作。 */}
          <div className="file-tree__breadcrumb-scrollbar">
            <div
              className="file-tree__breadcrumb-scrollbar-thumb"
              ref={bcThumbRef}
              onMouseDown={bcOnThumbMouseDown}
            />
          </div>
        </div>

        {/* 长路径展开后提供单独的折叠按钮。 */}
        {breadcrumbParts.length > 3 && breadcrumbExpanded && (
          <Tooltip title={t('sidebar.explorer.collapseBreadcrumb')} placement="bottom" mouseEnterDelay={0.3}>
            <button
              className="file-tree__breadcrumb-collapse"
              onClick={() => setBreadcrumbExpanded(false)}
              type="button"
            >
              <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="10" height="10" style={{ transform: 'rotate(-90deg)', color: 'var(--accent)', opacity: 0.7 }}>
                <path d="M704 514.368a52.864 52.864 0 0 1-15.808 37.888L415.872 819.2a55.296 55.296 0 0 1-73.984-2.752 52.608 52.608 0 0 1-2.816-72.512l233.6-228.928-233.6-228.992a52.736 52.736 0 0 1-17.536-53.056 53.952 53.952 0 0 1 40.192-39.424c19.904-4.672 40.832 1.92 54.144 17.216l272.32 266.88c9.92 9.792 15.616 23.04 15.808 36.8z" fill="currentColor" />
              </svg>
            </button>
          </Tooltip>
        )}
      </div>

      <DeleteFileModal {...deletion.dialog} />
      {directoryLoading && <div className="file-tree__status" role="status">{t('sidebar.explorer.loadingDirectory')}</div>}
      {directoryError && <div className="file-tree__status" role="alert">{directoryError}</div>}
      {/* Only visible rows exist in the DOM; native directories retain a bounded page cache. */}
      <VirtualFileList
        footer={creatingRow}
          scrollTarget={scrollTarget}
        key={`${currentDir}:${sortBy}:${sortOrder}`}
        count={directoryIndex?.total ?? sortedFiles.length}
        dataVersion={directoryIndex?.id}
        currentFilePath={activeTabId}
          onRangeChange={directoryIndex ? ensureDirectoryRange : undefined}
        pinnedIndex={renamingEntry?.index}
        isRowReady={(index) => Boolean(renamingEntry?.index === index || (directoryIndex ? getIndexedFile(directoryIndex, index) : sortedFiles[index]))}
        renderRow={(index, style, { deferDetails }) => {
          const file = renamingEntry?.index === index ? renamingEntry.file
            : directoryIndex ? getIndexedFile(directoryIndex, index) : sortedFiles[index];
          if (!file) return null;
          const isCurrent = activeTabId === file.path;
          const selectedPath = search.open && search.query.trim() && searchPath ? searchPath : activeTabId;
          const isActive = !isCreatingFile && selectedPath === file.path;

          return (
            <div
              key={file.path}
              style={renamingPath === file.path ? { ...style, width: '100%' } : style}
              role="listitem"
              tabIndex={0}
              data-path={file.path}
              data-directory-path={currentDir}
              aria-current={isCurrent ? 'true' : undefined}
              data-details={deferDetails ? 'deferred' : 'ready'}
              aria-setsize={directoryIndex?.total ?? sortedFiles.length}
              aria-posinset={index + 1}
              className={cn('file-tree__item', isActive && 'file-tree__item--active', isCurrent && 'file-tree__item--current')}
              onClick={() => handleFileClick(file)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget || renamingPath === file.path) return;
                if (event.key === 'Delete') { event.preventDefault(); deletion.request(file, event); }
                if (event.key === 'Enter') { event.preventDefault(); handleFileClick(file); }
              }}
            >
              <span className="file-tree__item-icon">
                <ExplorerEntryIcon file={file} defer={deferDetails} />
              </span>
              {renamingPath === file.path ? (
                <FileNameField
                  stem={renamingStem}
                  extension={renamingExt}
                  onStemChange={setRenamingStem}
                  onExtensionChange={setRenamingExt}
                  onCommit={commitRenaming}
                  onCancel={cancelRenaming}
                  autoFocus
                />
              ) : (
                <FileRowTooltip defer={deferDetails} title={file.name} placement="right" mouseEnterDelay={0.5}>
                  <span
                    className="file-tree__item-name"
                    // 双击名字进入重命名，与资源管理器一致；不用额外按钮占位。
                    onDoubleClick={(e) => { startRenaming(file, e, index); }}
                  >
                    <ExplorerMatchName name={file.name} search={search} />
                    {(() => {
                      if (deferDetails || file.is_dir) return null;
                      const extension = (file.name.split('.').pop() || '').toLowerCase();
                      const normalize = (value) => String(value || '').replace(/\\/g, '/');
                      const badge = fileBadges.find((entry) => {
                        if ((entry.extensions || []).includes(extension)) return true;
                        return (entry.paths || []).some((candidate) => {
                          const left = normalize(candidate);
                          const right = normalize(file.path);
                          return left === right || right.endsWith('/' + left) || left.endsWith('/' + right);
                        });
                      });
                      return badge
                        ? <Tooltip title={badge.title || ''} mouseEnterDelay={0.3}><span className="file-tree__item-badge"  dangerouslySetInnerHTML={{ __html: badge.svg }} /></Tooltip>
                        : null;
                    })()}
                  </span>
                </FileRowTooltip>
              )}

              {renamingPath !== file.path && <ExplorerDeleteButton file={file} defer={deferDetails} onClick={(event) => deletion.request(file, event)} />}
            </div>
          );
        }}
      />

    </div>
  );

  /**
   * 处理文件树项点击：目录进入、文件打开。
   *
   * @param {object} file 当前点击的文件树节点。
   */
  function handleFileClick(file) {
    if (file.is_dir) loadDirectory(file.path);
    else openFileFromPath(file.path, file.name);
  }
}

export default FileTree;
