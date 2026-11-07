import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import useFileStore from '@store/useFileStore';
import useEditorStore from '@store/useEditorStore';
import { useFileManager } from '@hooks/useFileManager';
import EditorContextMenu from '@components/editor/EditorContextMenu';
import usePathContextMenu from '@hooks/usePathContextMenu';
import useExplorerDeletion from '@hooks/useExplorerDeletion';
import DeleteFileModal from '@components/overlays/DeleteFileModal';
import ExplorerDeleteButton from './ExplorerDeleteButton';
import { isSafUri, safDisplayName } from '@utils/tauriApi';
import { sortDirectoryContents } from '@utils/directoryContents';
import { ProjectTreeModel } from '@utils/projectTreeModel';
import { inspectProjectChildren, projectDirectoryProvider, projectRootSource } from '@/services/projectDirectories';
import FileTypeIcon from '@components/ui/FileTypeIcon';
import MokiStatusEmpty from '@components/moki/MokiStatusEmpty';
import VirtualFileList from './VirtualFileList';
import FileNameField, { DEFAULT_FILE_EXTENSION } from './FileNameField';
import ExplorerNavigation from './ExplorerNavigation';
import ExplorerEntryIcon from './ExplorerEntryIcon';
import useExplorerSearch from '@hooks/useExplorerSearch';
import ExplorerMatchName from './ExplorerMatchName';
import './project-explorer.scss';

export default function ProjectExplorer() {
  const { t } = useTranslation();
  const currentDir = useFileStore((state) => state.currentDir);
  const snapshot = useFileStore((state) => state.directoryIndex);
  const files = useFileStore((state) => state.files);
  const loading = useFileStore((state) => state.directoryLoading);
  const error = useFileStore((state) => state.directoryError);
  const sortBy = useFileStore((state) => state.sortBy);
  const sortOrder = useFileStore((state) => state.sortOrder);
  const activeTabId = useEditorStore((state) => state.activeTabId);
  const { openFileFromPath, loadFilesOnly, loadDirectory, createFileInCurrentDir } = useFileManager();
  const [model, setModel] = useState(null);
  const [revision, setRevision] = useState(0);
  const [creating, setCreating] = useState(false);
  const [stem, setStem] = useState('');
  const [extension, setExtension] = useState(DEFAULT_FILE_EXTENSION);
  const [createError, setCreateError] = useState('');
  const [selected, setSelected] = useState(null);
  const pathMenu = usePathContextMenu(currentDir);
  const deletion = useExplorerDeletion(async ({ parent }) => {
    if (useFileStore.getState().currentDir !== currentDir) return;
    setSelected(null);
    setCreationFolder(null);
    if (parent.path === currentDir) await loadFilesOnly(currentDir);
    else if (model && !model.disposed) await model.refreshDirectory(parent);
  });
  // Tree selection follows browsing/searching. The editor's current document
  // is a separate state; switching editor tabs restores selection to that file.
  useEffect(() => { setSelected(null); }, [activeTabId]);
  const selectedPath = selected?.path || activeTabId;
  const [creationFolder, setCreationFolder] = useState(null);
  const [creationParent, setCreationParent] = useState(null);
  const [scrollTarget, setScrollTarget] = useState(null);
  const [expanding, setExpanding] = useState(false);
  const committing = useRef(false);
  const surface = useRef(null);
  const canvas = useRef(null);
  const overlay = useRef(null);
  const activeController = useRef(null);
  const animations = useRef([]);
  const rootTransition = useRef(false);
  const previousRows = useRef(null);
  const parentNavigation = useRef(null);
  const rememberRows = () => {
    previousRows.current = new Map([...surface.current?.querySelectorAll('[data-path]') || []]
      .map((element) => [element.dataset.path, element.getBoundingClientRect().top]));
  };
  useLayoutEffect(() => {
    if (rootTransition.current && model) {
      rootTransition.current = false;
      previousRows.current = null;
      if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches && canvas.current?.animate) {
        const timing = { duration: 260, easing: 'cubic-bezier(.22,.7,.25,1)', fill: 'both' };
        const incoming = canvas.current.animate([{ transform: 'translateY(-28px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], timing);
        const outgoing = overlay.current.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(28px)', opacity: 0 }], timing);
        animations.current = [incoming, outgoing];
        void Promise.all(animations.current.map((animation) => animation.finished)).catch(() => {}).finally(() => {
          if (animations.current[0] !== incoming) return;
          overlay.current?.replaceChildren();
          animations.current.forEach((animation) => animation.cancel());
          animations.current = [];
        });
      } else overlay.current?.replaceChildren();
      return;
    }
    if (!previousRows.current || !model || model.disposed || loading) return;
    const rows = surface.current?.querySelectorAll('[data-path]');
    if (!rows?.length) return;
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      for (const element of rows) {
        const oldTop = previousRows.current.get(element.dataset.path);
        const delta = oldTop == null ? -10 : oldTop - element.getBoundingClientRect().top;
        if (delta && Math.abs(delta) < 600) element.animate?.([
          { transform: `translateY(${delta}px)`, opacity: oldTop == null ? 0 : 1 },
          { transform: 'translateY(0)', opacity: 1 },
        ], { duration: 220, easing: 'cubic-bezier(.2,.7,.2,1)' });
      }
    }
    previousRows.current = null;
  }, [model, revision, loading]);
  const snapshotId = snapshot?.id;
  const latestSnapshot = useRef(snapshot);
  latestSnapshot.current = snapshot;
  const items = useMemo(() => snapshotId ? [] : sortDirectoryContents(files, { sortBy, sortOrder }), [snapshotId, files, sortBy, sortOrder]);

  useEffect(() => () => {
    activeController.current?.dispose();
    animations.current.forEach((animation) => animation.cancel());
  }, []);

  useEffect(() => {
    if (!currentDir) { activeController.current?.dispose(); activeController.current = null; setModel(null); return undefined; }
    // Keep the old viewport resident while the new snapshot and its first page
    // load. Publishing an empty/loading tree here causes visible flashes.
    if (loading) return undefined;
    let cancelled = false;
    const name = isSafUri(currentDir) ? safDisplayName(currentDir)
      : currentDir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || currentDir;
    const controller = new ProjectTreeModel({
      root: { path: currentDir, name, is_dir: true }, items,
      source: projectRootSource(latestSnapshot.current), loading,
      openDirectory: projectDirectoryProvider({ sortBy, sortOrder }),
      onChange: () => { if (activeController.current === controller) setRevision((value) => value + 1); },
    });
    const navigation = parentNavigation.current;
    void (async () => {
      if (!controller.root.source) controller.root.items = await inspectProjectChildren(items, () => !cancelled);
      if (cancelled) return;
      let nextSelected = null;
      if (navigation?.parent === currentDir) {
        const position = await controller.reveal({ path: navigation.child }, () => !cancelled);
        if (position != null && !cancelled) {
          const row = controller.get(position);
          const child = row.node?.expanded ? row.node : controller.toggle(row);
          if (child?.loading) await child.ready;
          nextSelected = row.file;
        }
      }
      const visibleRows = Math.ceil((canvas.current?.clientHeight || 640) / 32) + 50;
      await controller.preload(0, visibleRows);
      if (cancelled || controller.disposed) return;
      const previous = activeController.current;
      if (previous && previous.root.file.path !== currentDir && canvas.current && overlay.current) {
        animations.current.forEach((animation) => animation.finish());
        animations.current = [];
        const clone = canvas.current.cloneNode(true);
        overlay.current.replaceChildren(clone);
        const oldList = canvas.current.querySelector('.file-tree__list');
        const copyList = clone.querySelector('.file-tree__list');
        if (oldList && copyList) copyList.scrollTop = oldList.scrollTop;
        rootTransition.current = true;
      }
      parentNavigation.current = null;
      activeController.current = controller;
      setModel(controller); setSelected(nextSelected); setScrollTarget({ index: 0 }); setExpanding(false);
      previous?.dispose();
    })().catch((failure) => {
      if (!cancelled) { setCreateError(String(failure)); controller.dispose(); }
    });
    return () => { cancelled = true; if (activeController.current !== controller) controller.dispose(); };
  }, [currentDir, snapshotId, items, loading, sortBy, sortOrder]);

  const ready = !loading && model?.root.file.path === currentDir && model?.root.source?.id === snapshotId;
  useEffect(() => { setCreating(false); setCreateError(''); setCreationFolder(null); setCreationParent(null); }, [currentDir]);
  useLayoutEffect(() => {
    const collapsed = Boolean(model && !model.root.expanded);
    if (useFileStore.getState().projectRootCollapsed !== collapsed) useFileStore.setState({ projectRootCollapsed: collapsed });
    if (collapsed) setCreating(false);
    if (!model?.draft) setCreating(false);
  }, [model, revision]);
  useEffect(() => () => useFileStore.setState({ projectRootCollapsed: false }), []);
  useEffect(() => {
    let request = 0;
    let pending = false;
    const create = async () => {
      if (!ready || !model?.root.expanded || committing.current) return;
      const operation = ++request;
      pending = true;
      const parent = creationFolder || { ...model.root.file, ancestors: [] };
      setCreationParent(parent);
      setCreateError('');
      committing.current = false;
      setStem(''); setExtension(DEFAULT_FILE_EXTENSION);
      try {
        const position = await model.startDraft(parent);
        if (position == null || model.disposed || operation !== request) return;
        setCreating(true);
        setScrollTarget({ index: position, align: 'end', horizontalOffset: Math.min(model.draft.node.depth, 12) * 16 });
      } catch (failure) {
        if (!model.disposed && operation === request) {
          model.cancelDraft(); setCreating(false); setCreationParent(null); setCreateError(String(failure));
        }
      } finally { if (operation === request) pending = false; }
    };
    window.addEventListener('explorer:newFileRequest', create);
    return () => {
      request++; window.removeEventListener('explorer:newFileRequest', create);
      const state = useFileStore.getState();
      if (pending || state.currentDir !== model?.root.file.path || state.directoryLoading || state.explorerMode !== 'project') model?.cancelDraft();
    };
  }, [ready, model, creationFolder]);
  const ensureRange = useCallback((start, end, motion) => { if (ready) model?.ensureRange(start, end, motion); }, [model, ready]);
  const withAncestors = (row) => {
    const ancestors = [];
    for (let parent = row.parent; parent && parent !== model.root; parent = parent.parent) ancestors.unshift(parent.file.path);
    return { ...row.file, ancestors };
  };
  const activate = (row) => {
    if (!row?.file) return;
    setSelected(withAncestors(row));
    if (row.file.is_dir) {
      setCreationFolder(withAncestors(row));
      // Empty folders stay selectable but must not expand (no arrow, no IO).
      const knownEmpty = row.node ? !row.node.loading && row.node.error === '' && row.node.total === 0
        : model.directoryStateOf(row.file) === 'empty';
      if (knownEmpty && row.depth > 0) return;
      rememberRows(); model.toggle(row);
    } else openFileFromPath(row.file.path, row.file.name);
  };
  const search = useExplorerSearch({ root: loading ? '' : currentDir, recursive: true, version: snapshotId || files,
    onMatch: async (file, isCurrent) => {
      if (!model || model.disposed) return;
      rememberRows();
      const position = await model.reveal(file, isCurrent);
      if (position == null || !isCurrent() || model.disposed) return;
      await model.preload(Math.max(0, position - 12), position + 40);
      if (!isCurrent() || model.disposed) return;
      setSelected(file); setScrollTarget({ index: position, path: file.path, align: 'center', revealMatch: true });
    },
  });
  const expandSelected = async () => {
    if (!selected?.is_dir || !model) return;
    rememberRows();
    setExpanding(true);
    try { await model.expandDescendants(selected); }
    catch (failure) { if (!model.disposed) setCreateError(String(failure)); }
    finally { if (activeController.current === model) setExpanding(false); }
  };
  const commitNewFile = async () => {
    if (committing.current || !model?.draft) return;
    const name = stem.trim();
    if (!name) { model.cancelDraft(); setCreating(false); setCreationParent(null); return; }
    committing.current = true;
    try {
      const parent = creationParent || { ...model.root.file, ancestors: [] };
      const fileName = extension && !name.endsWith(extension) ? `${name}${extension}` : name;
      const result = await createFileInCurrentDir(fileName, parent.path);
      if (model.disposed || activeController.current !== model) return;
      if (result?.ok) {
        model.cancelDraft({ restore: false });
        setCreating(false);
        if (parent.path !== currentDir && !model.disposed) {
          await model.refreshDirectory(parent);
          const created = { path: result.path, name: fileName, is_dir: false,
            ancestors: [...(parent.ancestors || []), parent.path] };
          const position = await model.reveal(created);
          if (position != null && !model.disposed) { setSelected(created); setScrollTarget({ index: position, path: created.path }); }
        }
      } else {
        model.cancelDraft(); setCreating(false); setCreationParent(null);
      }
    } catch (failure) {
      if (!model.disposed && activeController.current === model) {
        model.cancelDraft(); setCreating(false); setCreationParent(null); setCreateError(String(failure));
      }
    }
    finally { committing.current = false; }
  };

  if (!currentDir) return <MokiStatusEmpty title={t('empty.files.title')} hint={t('empty.files.hint')} />;

  return <div className="file-tree project-tree" ref={surface}>
    <DeleteFileModal {...deletion.dialog} />
    <EditorContextMenu menu={pathMenu.menu} onClose={pathMenu.closeMenu} />
    <ExplorerNavigation search={search} project busy={!ready}
      onParent={(parent) => { search.setQuery(''); model?.cancelExpansion(); parentNavigation.current = { parent, child: currentDir }; void loadDirectory(parent); }}
      canOpenSelected={Boolean(ready && selected?.is_dir && selected.path !== currentDir)}
      onOpenSelected={() => { if (selected?.is_dir && selected.path !== currentDir) { search.setQuery(''); model?.cancelExpansion(); void loadDirectory(selected.path); } }}
      onExpandSelected={expandSelected} canExpandSelected={Boolean(ready && selected?.is_dir && !expanding)}
      onCollapseAll={() => { rememberRows(); model?.collapseAll(); setScrollTarget({ index: 0 }); }}
      canCollapseAll={Boolean(model && model.root.expanded)} />
    {error && <div className="file-tree__status" role="alert">{error}</div>}
    <div className="project-tree__body" aria-busy={!ready}>
    <div className="project-tree__canvas" ref={canvas} inert={!ready ? '' : undefined}>
    {model && !model.disposed && <VirtualFileList
      resetKey={model}
      currentFilePath={creating ? '' : activeTabId}
      scrollTarget={scrollTarget}
      role="tree"
      ariaLabel={t('sidebar.project.title')}
      count={model.count}
      pinnedIndex={model.draftPosition}
      dataVersion={`${snapshotId || 'legacy'}:${revision}`}
      onRangeChange={ensureRange}
      isRowReady={(position) => { const row = model.get(position); return Boolean(row?.file || row?.draft || row?.status === 'error'); }}
      renderRow={(position, style, { deferDetails }) => {
        const row = model.get(position);
        if (!row) return null;
        const indent = 8 + Math.min(row.depth, 12) * 16;
        if (row.draft) return <div key="new-file" className="file-tree__item file-tree__item--creating" style={{ ...style, width: '100%', paddingLeft: indent + 24, gap: 6 }} data-parent-path={creationParent?.path}>
          <FileTypeIcon fileName={`${stem || 'untitled'}${extension}`} />
          <FileNameField stem={stem} extension={extension} onStemChange={setStem} onExtensionChange={setExtension}
            onCommit={commitNewFile} onCancel={() => { model.cancelDraft(); setCreating(false); setCreationParent(null); }} placeholder={t('sidebar.explorer.newFilePlaceholder')} autoFocus />
        </div>;
        if (row.status && row.status !== 'error') return null;
        if (row.status) return <div key={`status-${row.node.id}`} className="project-tree__status" role="alert" style={{ ...style, paddingLeft: indent + 24 }}>
          <span>{row.status === 'error' ? row.node.error : t(`sidebar.project.${row.status}`)}</span>
          {row.status === 'error' && <button type="button" onClick={() => row.node === model.root ? loadFilesOnly(currentDir) : model.retry(row.node)}>{t('sidebar.project.retry')}</button>}
        </div>;
        if (!row.file) return null;
        const { file, node } = row;
        const requestDeletion = (event) => {
          if (!row.parent) return;
          const parent = withAncestors({ file: row.parent.file, parent: row.parent.parent });
          deletion.request({ ...file, parent }, event);
        };
        const expanded = Boolean(node?.expanded);
        const isSelected = !creating && selectedPath === file.path;
        const isCurrent = !creating && activeTabId === file.path;
        const state = model.directoryStateOf(file);
        const failed = file.is_dir && Boolean(node?.error || ((!node || node.loading) && state === 'unreadable'));
        // A denied folder also has total === 0 (never assigned); it must keep its
        // arrow, otherwise collapsing hides the red error arrow entirely.
        const empty = file.is_dir && !failed && row.depth > 0 && model.draft?.node !== node
          && (node ? !node.loading && node.error === '' && node.total === 0 : state === 'empty');
        const name = <span className="project-tree__name"><ExplorerMatchName name={file.name} search={search} /></span>;
        return <div
          key={file.path}
          role="treeitem"
          tabIndex={0}
          aria-label={file.name}
          aria-level={row.depth + 1}
          aria-posinset={row.parent ? row.index + 1 : 1}
          aria-setsize={row.parent?.total || 1}
          aria-expanded={file.is_dir ? expanded : undefined}
          aria-busy={node?.loading || undefined}
          data-path={file.path}
          data-directory-path={row.parent?.file.path || currentDir}
          aria-selected={isSelected}
          aria-current={isCurrent ? 'true' : undefined}
          className={`project-tree__row${row.depth === 0 ? ' project-tree__row--root' : ''}${isSelected ? ' project-tree__row--active' : ''}${isCurrent ? ' project-tree__row--current' : ''}`}
          style={{ ...style, paddingLeft: indent }}
          onClick={(event) => { if (event.detail < 2) activate(row); }}
          onContextMenu={(event) => pathMenu.onPathMenu(event, file.path)}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (['Enter', ' '].includes(event.key)) { event.preventDefault(); activate(row); }
            if (event.key === 'Delete' && row.parent) { event.preventDefault(); requestDeletion(event); }
            if (event.key === 'ArrowRight' && file.is_dir && !expanded) { event.preventDefault(); activate(row); }
            if (event.key === 'ArrowLeft' && file.is_dir && expanded) { event.preventDefault(); activate(row); }
          }}
        >
          {file.is_dir && !empty ? <button
            type="button" tabIndex={-1}
            className={`project-tree__toggle${expanded ? ' project-tree__toggle--expanded' : ''}${failed ? ' project-tree__toggle--error' : ''}`}
            aria-label={t(expanded ? 'sidebar.project.collapseFolder' : 'sidebar.project.expandFolder', { name: file.name })}
            onClick={(event) => { event.stopPropagation(); if (event.detail < 2) activate(row); }}
          ><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg></button>
            : <span className="project-tree__toggle-space" />}
          <span className="project-tree__icon"><ExplorerEntryIcon file={file} expanded={expanded && !empty} defer={deferDetails} /></span>
          {deferDetails ? name : <Tooltip title={file.path} placement="right" mouseEnterDelay={0.6}>{name}</Tooltip>}
          {row.parent && <ExplorerDeleteButton file={file} defer={deferDetails} onClick={requestDeletion} />}
        </div>;
      }}
    />}
    </div>
    <div className="project-tree__overlay" ref={overlay} aria-hidden="true" inert="" />
    {expanding && <div className="project-tree__progress" role="status">{t('sidebar.project.expanding')}</div>}
    </div>
    {createError && <div className="file-tree__status" role="alert">{createError}</div>}
  </div>;
}
