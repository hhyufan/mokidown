import { useMemo, useRef, useState } from 'react';
import { Button, Tooltip } from 'antd';
import {
  ApartmentOutlined, PlusOutlined,
  ZoomInOutlined, ZoomOutOutlined, OneToOneOutlined, CloseCircleOutlined,
  VerticalAlignTopOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import useEditorStore from '@store/useEditorStore';
import useConfigStore from '@store/useConfigStore';
import { useEditorBufferContent } from '../../hooks/useEditorBufferContent';
import { useDocumentScrollState } from '@hooks/useDocumentScrollState';
import { getBuffer, setBuffer } from '@utils/editorBuffer';
import { editTreeSource, flattenTree, parseTreeText } from '@utils/mgtree';
import { useEditorContextMenu } from '@hooks/useEditorContextMenu';
import EditorContextMenu from './EditorContextMenu';
import { MENU_MOD } from '@utils/contextMenuShortcuts';
import TreeView, { InlineTreeTitle, TreeNodeRow, TreeControls } from './TreeView';
import TreeNodeEditor from './TreeNodeEditor';
import TreeJumpEditor from './TreeJumpEditor';
import './tree-editor.scss';

function readExpanded(storageKey) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    return Array.isArray(saved) ? saved.filter((key) => typeof key === 'string') : [];
  } catch { return []; }
}

export default function TreeEditor({ className = '', onAutoSave, onSourceChange }) {
  const { t } = useTranslation();
  const tabId = useEditorStore((s) => s.activeTabId);
  const tab = useEditorStore((s) => s.tabs.find((item) => item.id === tabId));
  const fontSize = useConfigStore((s) => s.previewFontSize || s.fontSize || 14);
  const source = useEditorBufferContent(tabId, tab?.content || '', 100);
  const nodes = useMemo(() => parseTreeText(source), [source]);
  const flat = useMemo(() => flattenTree(nodes), [nodes]);
  const storageKey = `mokidown-tree-expanded:${tab?.path || tabId}`;
  const [expanded, setExpanded] = useState(() => readExpanded(storageKey));
  const [editing, setEditing] = useState(null);
  const [jumpEditing, setJumpEditing] = useState(null);
  const [editSize, setEditSize] = useState(null);
  const titleRefs = useRef(new Map());
  const lastWrite = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [showTop, setShowTop] = useState(false);
  const scrollRef = useRef(null);
  useDocumentScrollState(scrollRef, tabId, 'tree');
  const { menu, openMenu, closeMenu } = useEditorContextMenu(`${tabId}:${source}`);

  const updateExpanded = (keys) => {
    setExpanded(keys);
    try { localStorage.setItem(storageKey, JSON.stringify(keys)); } catch { /* Storage may be unavailable. */ }
  };

  const commit = (operation, expectedSource = source) => {
    // Reject stale row actions while the source pane has a pending render.
    const current = getBuffer(tabId, tab?.content || '');
    if (current !== expectedSource) { setEditing(null); return; }
    const next = editTreeSource(current, operation);
    if (next === current) return;
    if (!onSourceChange?.(next)) setBuffer(tabId, next);
    lastWrite.current = { tabId, source: next };
    useEditorStore.getState().markTabDirty(tabId, true);
    useEditorStore.getState().setCharacterCount(next.length);
    onAutoSave?.();
    return next;
  };

  const startEdit = (node) => {
    const title = titleRefs.current.get(node.key);
    setEditSize(title ? { width: title.offsetWidth, height: title.offsetHeight } : null);
    setEditing(node.key);
  };

  const saveEdit = (node, title) => {
    const cleanTitle = title.trim();
    if (cleanTitle) {
      // Keep the original operator, index and spacing out of the title editor.
      const suffix = node.jumpLanguage ? node.originalText.slice(node.title.length) : '';
      commit({ type: 'rename', node, value: cleanTitle + suffix });
    }
    setEditing(null);
  };
  const saveJump = (node, suffix) => {
    const current = getBuffer(tabId, tab?.content || '');
    // A field losing focus saves its title before this form submits. Rebase
    // that local write while still rejecting changes from the source editor.
    if (current !== source && (lastWrite.current?.tabId !== tabId || lastWrite.current.source !== current)) return false;
    const latest = flattenTree(parseTreeText(current)).find((item) => item.lineIndex === node.lineIndex);
    if (!latest) return false;
    const value = latest.title + (suffix ? ` ${suffix}` : '');
    if (value === latest.originalText) return true;
    return commit({ type: 'rename', node: latest, value }, current) !== undefined;
  };

  const addNode = (parent) => {
    const next = commit({ type: 'add', node: parent, value: t('tree.newNode') });
    if (next === undefined) return;
    const updated = flattenTree(parseTreeText(next));
    const index = parent ? updated.findIndex((item) => item.lineIndex === parent.lineIndex) : -1;
    const newNode = parent ? flattenTree([updated[index]]).at(-1) : updated.at(-1);
    const addedLine = newNode.lineIndex;
    updateExpanded([...new Set([
      ...expanded.map((key) => {
        const line = Number(key.slice(5));
        return line >= addedLine ? `line-${line + 1}` : key;
      }), ...(parent ? [parent.key] : []),
    ])]);
    startEdit(newNode);
  };

  const deleteNode = (node) => {
    const next = commit({ type: 'delete', node });
    if (next === undefined) return;
    const last = flattenTree([node]).at(-1).lineIndex;
    const count = last - node.lineIndex + 1;
    updateExpanded(expanded.flatMap((key) => {
      const line = Number(key.slice(5));
      if (line >= node.lineIndex && line <= last) return [];
      return [line > last ? `line-${line - count}` : key];
    }));
    setEditing(null);
  };

  const handleContextMenu = (event, node = null) => {
    if (event.target.closest('input, textarea, [contenteditable="true"]')) return;
    const item = (key, run, extra = {}) => ({ key, label: t(`tree.${key}`), run, ...extra });
    const items = node ? [
      { key: 'copy', label: t('editor.menu.copy'), shortcut: `${MENU_MOD}+C`, run: () => navigator.clipboard.writeText(node.originalText) },
      { key: 's1', separator: true },
      item('editNode', () => startEdit(node), { shortcut: 'F2' }),
      item('addChild', () => addNode(node), { shortcut: 'Insert' }),
      { key: 's2', separator: true },
      item('deleteNode', () => deleteNode(node), { danger: true, shortcut: 'Delete' }),
    ] : [
      item('addRoot', () => addNode(null), { shortcut: 'Insert' }),
      { key: 's1', separator: true },
      item('expandAll', () => updateExpanded(flat.filter((node) => node.children.length).map((node) => node.key))),
      item('collapseAll', () => updateExpanded([])),
      { key: 's2', separator: true },
      { key: 'copyAll', label: t('editor.menu.copyAll'), run: () => navigator.clipboard.writeText(source) },
    ];
    openMenu(event, items, 'tree');
  };

  const action = (name, icon, onClick, extra = {}) => (
    <Tooltip title={t(`tree.${name}`)}>
      <Button type="text" size="small" aria-label={t(`tree.${name}`)} icon={icon} onClick={onClick} {...extra} />
    </Tooltip>
  );

  const renderTitle = (node) => (
        <TreeNodeRow node={node} actions={renderActions(node)} reference={<TreeJumpEditor node={node}
          open={jumpEditing?.tabId === tabId && jumpEditing.key === node.key}
          onOpenChange={(open) => setJumpEditing((previous) => open ? { tabId, key: node.key }
            : previous?.tabId === tabId && previous.key === node.key ? null : previous)}
          onApply={(suffix) => saveJump(node, suffix)} />}
          onContextMenu={(event) => handleContextMenu(event, node)}>
          {editing === node.key ? (
            <TreeNodeEditor key={node.key} source={node.title} size={editSize}
              onSave={(title) => saveEdit(node, title)} onCancel={() => setEditing(null)} />
          ) : (
            <Tooltip title={t('tree.editHint')} placement="top" mouseEnterDelay={0.3}>
              <button type="button" className="moki-tree__title"
                ref={(element) => { if (element) titleRefs.current.set(node.key, element); else titleRefs.current.delete(node.key); }}
                onClick={(event) => { event.stopPropagation(); startEdit(node); }}>
                <InlineTreeTitle title={node.title || t('tree.newNode')} />
              </button>
            </Tooltip>
          )}
        </TreeNodeRow>
  );
  const renderActions = (node) => editing !== node.key && (
            <span className="moki-tree__actions" onClick={(event) => event.stopPropagation()}>
              {action('addChild', <PlusOutlined />, () => addNode(node))}
              {action('deleteNode', <CloseCircleOutlined />, () => deleteNode(node), { danger: true })}
            </span>
          );

  return (
    <section className={`moki-tree ${className}`} aria-label={t('tree.title')} style={{ '--tree-font-size': `${fontSize}px` }} onContextMenu={(event) => handleContextMenu(event)}>
      <EditorContextMenu menu={menu} onClose={closeMenu} />
      <div className="moki-tree__toolbar">
        <div className="moki-tree__tools">
          {action('addRoot', <PlusOutlined />, () => addNode(null), { className: 'moki-tree__add' })}
          <span className="moki-tree__separator" />
          {action('zoomIn', <ZoomInOutlined />, () => setZoom((z) => Math.min(3, z + 0.2)), { disabled: zoom >= 3 })}
          {action('zoomOut', <ZoomOutOutlined />, () => setZoom((z) => Math.max(0.5, z - 0.2)), { disabled: zoom <= 0.5 })}
          {action('resetZoom', <OneToOneOutlined />, () => setZoom(1))}
          <span className="moki-tree__zoom">{Math.round(zoom * 100)}%</span>
        </div>
        <span className="moki-tree__count"><ApartmentOutlined />{t('tree.nodeCount', { count: flat.length })}</span>
        <TreeControls onExpandAll={() => updateExpanded(flat.filter((node) => node.children.length).map((node) => node.key))}
          onCollapseAll={() => updateExpanded([])} />
      </div>
      <div className="moki-tree__scroll" ref={scrollRef} onScroll={(event) => setShowTop(event.currentTarget.scrollTop > 240)}>
        {nodes.length ? (
          <div className="moki-tree__canvas" style={{ zoom }}>
            <TreeView nodes={nodes} expandedKeys={expanded} onExpand={updateExpanded}
              renderTitle={renderTitle} />
          </div>
        ) : (
          <div className="moki-tree__empty">
            <ApartmentOutlined /><strong>{t('tree.empty')}</strong><p>{t('tree.emptyHint')}</p>
            <Button onClick={() => addNode(null)} icon={<PlusOutlined />}>{t('tree.addRoot')}</Button>
          </div>
        )}
      </div>
      <div className="moki-tree__hint">{t('tree.hint', { shortcut: `${MENU_MOD}+E` })}</div>
      {showTop && <Tooltip title={t('tree.backToTop')}><button className="moki-tree__top" type="button" aria-label={t('tree.backToTop')}
        onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}><VerticalAlignTopOutlined /></button></Tooltip>}
    </section>
  );
}
