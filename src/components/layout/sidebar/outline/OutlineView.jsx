import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useEditorStore from '@store/useEditorStore';
import { useEditorBufferContent } from '@hooks/useEditorBufferContent';
import { useMarkdownAnalysis } from '@hooks/useMarkdownAnalysis';
import { useMarkdownJumpFeedback } from '@hooks/useMarkdownJumpFeedback';
import { outlineRows } from '@utils/markdownOutline';
import useConfigStore from '@store/useConfigStore';
import MokiStatusEmpty from '@components/moki/MokiStatusEmpty';
import './outline.scss';

const expandedOutline = {};

function groupRows(rows, minLevel) {
  const children = new Map();
  for (const row of rows) {
    if (!children.has(row.parent)) children.set(row.parent, []);
    children.get(row.parent).push(row);
  }
  return groupChildren(children.get(undefined) ?? [], children, minLevel);
}

function groupChildren(rows, children, minLevel) {
  const groups = [];
  for (const row of rows) {
    const { item } = row;
    const branch = children.get(row.index);
    const drawer = branch ? groupChildren(branch, children, minLevel) : null;
    if (item.type === 'heading') {
      groups.push({ heading: row, depth: item.level - minLevel + (item.indent ?? 0), drawer });
      continue;
    }
    const depth = Math.max(0, item.parentLevel - minLevel + 1) + item.indent;
    const tag = item.type === 'list-ordered' ? 'ol' : 'ul';
    const last = groups.at(-1);
    if (!drawer && last?.tag === tag && last.depth === depth && !last.drawer) last.rows.push(row);
    else groups.push({ tag, depth, rows: [row], drawer });
  }
  return groups;
}

/**
 * Markdown 大纲视图。
 *
 * 解析当前缓冲区中的标题与列表层级，支持折叠、展开以及与编辑区/预览区的
 * 双向跳转联动。
 */
function OutlineView() {
  const { t } = useTranslation();
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const cascade = useConfigStore((s) => s.markdownTaskCascade !== false);
  const showJump = useMarkdownJumpFeedback(activeTabId);
  const fallback = useMemo(() => {
    const tab = useEditorStore.getState().tabs.find((t) => t.id === activeTabId);
    return tab?.content || '';
  }, [activeTabId]);
  const content = useEditorBufferContent(activeTabId, fallback, 320);
  const [collapsed, setCollapsed] = useState({});
  const { value: items } = useMarkdownAnalysis(activeTabId, content, 'outline');

  const headings = useMemo(() => items.filter((it) => it.type === 'heading'), [items]);
  const minLevel = useMemo(
    () =>
      headings.length > 0
        ? headings.reduce((level, heading) => Math.min(level, heading.level), 6)
        : 1,
    [headings],
  );

  const rows = useMemo(() => outlineRows(items, expandedOutline), [items]);
  const groups = useMemo(() => groupRows(rows, minLevel), [rows, minLevel]);

  // 监听工具栏发出的全局折叠/展开事件。
  useEffect(() => {
    const handleCollapseAll = () => {
      const next = {};
      rows.forEach(({ index, canCollapse }) => {
        if (canCollapse) next[index] = true;
      });
      setCollapsed(next);
    };
    const handleExpandAll = () => setCollapsed({});

    window.addEventListener('outline:collapseAll', handleCollapseAll);
    window.addEventListener('outline:expandAll', handleExpandAll);
    return () => {
      window.removeEventListener('outline:collapseAll', handleCollapseAll);
      window.removeEventListener('outline:expandAll', handleExpandAll);
    };
  }, [rows]);

  function toggleCollapse(idx) {
    setCollapsed((prev) => ({ ...prev, [idx]: !prev[idx] }));
  }

  function renderToggle(index) {
    return (
      <button
        type="button"
        className="outline__toggle"
        aria-expanded={!collapsed[index]}
        aria-label={t(collapsed[index] ? 'editor.expandSection' : 'editor.collapseSection')}
        onClick={(event) => {
          event.stopPropagation();
          toggleCollapse(index);
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    );
  }

  function jump(event, item) {
    showJump(event.currentTarget, { scroll: false });
    window.dispatchEvent(
      new CustomEvent('outline:jump', {
        detail: { ...item, tabId: activeTabId },
      }),
    );
  }

  function renderDrawer(drawer, index) {
    if (!drawer) return null;
    const closed = Boolean(collapsed[index]);
    return (
      <div className="outline__drawer" data-expanded={!closed} aria-hidden={closed || undefined}>
        <div className="outline__drawer-content" inert={closed ? '' : undefined}>
          {renderGroups(drawer)}
        </div>
      </div>
    );
  }

  if (!activeTabId) {
    return (
      <MokiStatusEmpty
        title={t('empty.outlineNoFile.title')}
        hint={t('empty.outlineNoFile.hint')}
      />
    );
  }
  if (items.length === 0) {
    return <MokiStatusEmpty title={t('empty.outline.title')} hint={t('empty.outline.hint')} />;
  }

  function renderGroups(groups) {
    return groups.map(({ heading, tag: List, depth, rows: entries, drawer }) => {
      const style = { '--outline-depth': depth };
      if (heading) {
        const { item, index, canCollapse } = heading;
        const Heading = `h${item.level}`;
        return (
          <Fragment key={index}>
            <div
              className="outline__item outline__item--heading"
              style={style}
              onClick={(event) => jump(event, item)}
            >
              {canCollapse ? renderToggle(index) : <span />}
              <Heading className="outline__heading">
                <button type="button" className="outline__jump" title={item.text}>
                  {item.text}
                </button>
              </Heading>
              <span className="outline__heading-level" aria-hidden="true">
                H{item.level}
              </span>
            </div>
            {renderDrawer(drawer, index)}
          </Fragment>
        );
      }
      return (
        <Fragment key={entries[0].index}>
          <List className="outline__list" style={style}>
            {entries.map(({ item, index, canCollapse }) => {
              const taskState =
                item.taskState == null
                  ? undefined
                  : cascade
                    ? item.taskState
                    : String(item.checked);
              return (
                <li
                  key={index}
                  className={`outline__item outline__item--${item.type}`}
                  value={item.order}
                  data-outline-nested={item.indent > 0 || undefined}
                  data-task-state={taskState}
                  onClick={(event) => jump(event, item)}
                >
                  {canCollapse && renderToggle(index)}
                  <button
                    type="button"
                    className="outline__jump"
                    title={item.text || undefined}
                    aria-label={
                      item.text
                        ? undefined
                        : t(taskState == null ? 'sidebar.outline.listItem' : 'toolbar.taskList')
                    }
                  >
                    {taskState != null && (
                      <span
                        className="md-preview__task-checkbox"
                        role="checkbox"
                        aria-checked={taskState}
                        aria-disabled="true"
                        aria-label={t('toolbar.taskList')}
                      />
                    )}
                    <span className="outline__text">{item.text || '\u00a0'}</span>
                  </button>
                </li>
              );
            })}
          </List>
          {renderDrawer(drawer, entries[0].index)}
        </Fragment>
      );
    });
  }

  return <div className="outline">{renderGroups(groups)}</div>;
}

export default OutlineView;
export { extractItems } from '@utils/markdownOutline';
