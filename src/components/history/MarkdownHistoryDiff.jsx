import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';
import MarkdownComparisonEditor from './MarkdownComparisonEditor';
import { useMarkdownComparisonAlignment } from './useMarkdownComparisonAlignment';

export const HISTORY_FOLD_CONTEXT = 1;
export const HISTORY_FOLD_MINIMUM = 2;
const MARKDOWN_FOLD_MINIMUM = 4;
const comparisonSides = ['original', 'modified'];

const lineCount = (row) => row.lastModified - row.firstModified + 1;

function foldRows(rows, foldState, previous) {
  const visible = [];
  const collapsedRanges = [];
  const appendRows = (start, end) => {
    for (let i = start; i < end; i++) visible.push(rows[i]);
  };
  let collapsedCount = 0;
  let expandedCount = 0;
  const preserved =
    previous && (previous.foldState === foldState || foldState.overrides.size)
      ? previous.collapsedRanges
      : null;
  if (!preserved && !rows.some((row) => row.changed)) {
    return { visible: rows, collapsedCount, expandedCount, collapsedRanges };
  }
  let rangeIndex = 0;
  const previousRange = (row) => {
    if (!preserved || row.firstOriginal == null) return undefined;
    while (preserved[rangeIndex]?.[1] < row.firstOriginal) rangeIndex++;
    const range = preserved[rangeIndex];
    return range && row.firstOriginal >= range[0] && row.lastOriginal <= range[1]
      ? range
      : undefined;
  };
  for (let start = 0; start < rows.length;) {
    if (rows[start].changed || rows[start].firstModified == null) {
      visible.push(rows[start++]);
      continue;
    }
    const existingRange = previousRange(rows[start]);
    let end = start + 1;
    while (
      end < rows.length &&
      !rows[end].changed &&
      rows[end].firstModified != null &&
      previousRange(rows[end]) === existingRange
    )
      end++;
    // Keep a line of context next to changes without cutting into a Markdown block.
    const first =
      rows[start - 1]?.changed && lineCount(rows[start]) <= HISTORY_FOLD_CONTEXT
        ? start + 1
        : start;
    const last =
      rows[end]?.changed && lineCount(rows[end - 1]) <= HISTORY_FOLD_CONTEXT ? end - 1 : end;
    const group = rows.slice(first, last);
    const count = group.length ? group.at(-1).lastModified - group[0].firstModified + 1 : 0;
    const firstOriginal = group.find((row) => row.firstOriginal != null)?.firstOriginal;
    const lastOriginal = group.findLast((row) => row.lastOriginal != null)?.lastOriginal;
    if (
      firstOriginal == null ||
      count < MARKDOWN_FOLD_MINIMUM ||
      !group.some(({ hasContent }) => hasContent)
    ) {
      appendRows(start, end);
    } else {
      const hiddenStart = group[0].firstModified;
      const hiddenEnd = group.at(-1).lastModified;
      const key = `fold:${firstOriginal}:${lastOriginal}`;
      const expanded =
        foldState.overrides.get(key) ?? (preserved ? !existingRange : foldState.defaultExpanded);
      appendRows(start, first);
      if (expanded) {
        expandedCount++;
        visible.push({ ...group[0], expandedFold: { key } });
        appendRows(first + 1, last);
      } else {
        collapsedCount++;
        collapsedRanges.push([firstOriginal, lastOriginal]);
        visible.push({
          key,
          count,
          fold: true,
          firstModified: hiddenStart,
          lastModified: hiddenEnd,
          firstOriginal,
          lastOriginal,
        });
      }
      appendRows(last, end);
    }
    start = end;
  }
  return { visible, collapsedCount, expandedCount, collapsedRanges };
}

function comparisonLayout(rows, blocks, firstLine, lastLine) {
  const rowByLine = [];
  const foldedLines = [];
  for (const row of rows) {
    const start = row[firstLine];
    const end = row[lastLine];
    if (start == null) continue;
    if (row.fold) {
      for (let line = start; line <= end; line++) foldedLines[line] = true;
      continue;
    }
    for (let line = start; line <= end; line++) rowByLine[line] = row.key;
  }
  return { blocks, rowByLine, foldedLines, keys: rows.map(({ key }) => key) };
}

function DiffCell({ change, gap, side }) {
  return (
    <div
      className="history-markdown-diff__cell"
      data-side={side}
      data-change={change}
      data-gap={gap || undefined}
    >
      {change && (
        <span className="history-markdown-diff__marker" aria-hidden="true">
          {change === 'removed' ? '−' : '+'}
        </span>
      )}
    </div>
  );
}

export default function MarkdownHistoryDiff({
  tabId,
  original,
  originalPath,
  modifiedPath,
  draftContent,
  comparison,
  previewBoundsRef,
  hidden,
  foldState,
  ready,
  busy,
  onRevert,
  onToggleFold,
  onFoldSummary,
  onDraftChange,
}) {
  const { t } = useTranslation();
  const scrollRef = useRef(null);
  const previousFolds = useRef(null);
  const [currentReady, setCurrentReady] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const markCurrentReady = useCallback(() => {
    setCurrentReady(true);
  }, []);
  useEffect(() => {
    if (!currentReady) return undefined;
    let next;
    const first = requestAnimationFrame(() => {
      next = requestAnimationFrame(() => {
        setShowOriginal(true);
      });
    });
    return () => {
      cancelAnimationFrame(first);
      if (next) cancelAnimationFrame(next);
    };
  }, [currentReady]);
  const { rows, originalBlocks, modifiedBlocks } = comparison;
  const { visible, collapsedCount, expandedCount, collapsedRanges } = useMemo(
    () => foldRows(rows, foldState, previousFolds.current),
    [rows, foldState],
  );
  useLayoutEffect(() => {
    previousFolds.current = { foldState, collapsedRanges };
  }, [foldState, collapsedRanges]);
  useMarkdownComparisonAlignment(scrollRef, visible);
  useEffect(() => {
    onFoldSummary({ collapsedCount, expandedCount });
  }, [collapsedCount, expandedCount, onFoldSummary]);
  const originalLayout = useMemo(
    () => comparisonLayout(visible, originalBlocks, 'firstOriginal', 'lastOriginal'),
    [visible, originalBlocks],
  );
  const modifiedLayout = useMemo(
    () => comparisonLayout(visible, modifiedBlocks, 'firstModified', 'lastModified'),
    [visible, modifiedBlocks],
  );

  return (
    <div
      ref={scrollRef}
      className="history-markdown-diff history-markdown-draft"
      aria-busy={!ready}
      data-comparison-zoom="preview"
      hidden={hidden}
    >
      <div className="history-markdown-draft__layout">
        {visible.map((row) => {
          if (row.fold) {
            const action = t('history.expandHiddenLines', { count: row.count });
            return (
              <div
                className="history-markdown-diff__row"
                key={row.key}
                data-history-row={row.key}
                data-fold
              >
                {comparisonSides.map((side) => (
                  <button
                    key={side}
                    className="history-markdown-diff__fold"
                    type="button"
                    aria-label={action}
                    aria-expanded={false}
                    onClick={() => onToggleFold(row, true)}
                  >
                    <span className="codicon codicon-unfold" aria-hidden="true" />
                    <span>{t('history.hiddenLines', { count: row.count })}</span>
                  </button>
                ))}
              </div>
            );
          }
          return (
            <div
              className="history-markdown-diff__row"
              key={row.key}
              data-history-row={row.key}
              data-changed={row.changed || undefined}
            >
              {row.expandedFold &&
                comparisonSides.map((side) => (
                  <Tooltip
                    key={side}
                    title={t('history.foldUnchangedRegion')}
                    mouseEnterDelay={0.3}
                  >
                    <button
                      type="button"
                      className="history-markdown-diff__fold-action"
                      data-side={side}
                      aria-label={t('history.foldUnchangedRegion')}
                      aria-expanded={true}
                      onClick={() => onToggleFold(row.expandedFold, false)}
                    >
                      <span className="codicon codicon-fold" aria-hidden="true" />
                    </button>
                  </Tooltip>
                ))}
              {row.changed && (
                <>
                  <DiffCell
                    side="original"
                    change={row.removed ? 'removed' : undefined}
                    gap={row.originalGap}
                  />
                  <DiffCell
                    side="modified"
                    change={row.added ? 'added' : undefined}
                    gap={row.modifiedGap}
                  />
                </>
              )}
              {onRevert && ['left', 'right'].map((direction) => {
                const actions = row.actions.filter((action) => action.direction === direction);
                const label = t(
                  direction === 'left' ? 'history.revertAddition' : 'history.revertChange',
                );
                return (
                  actions.length > 0 && (
                    <div
                      className="history-markdown-diff__revert-actions"
                      data-direction={direction}
                      key={direction}
                    >
                      {actions.map(({ change }) => (
                        <Tooltip
                          key={
                            change.originalStartLineNumber + ':' + change.modifiedStartLineNumber
                          }
                          title={label}
                          placement="top"
                          mouseEnterDelay={0.3}
                        >
                          <button
                            type="button"
                            className="history-markdown-diff__revert"
                            disabled={busy || !ready}
                            aria-label={label}
                            onClick={() => onRevert(change)}
                          >
                            <span
                              className={`codicon codicon-arrow-${direction}`}
                              aria-hidden="true"
                            />
                          </button>
                        </Tooltip>
                      ))}
                    </div>
                  )
                );
              })}
            </div>
          );
        })}
        {showOriginal ? (
          <MarkdownComparisonEditor
            tabId={tabId}
            content={original}
            layout={originalLayout}
            previewBoundsRef={previewBoundsRef}
            filePath={originalPath}
            readOnly
          />
        ) : (
          <div
            className="history-markdown-draft__pane history-diff__error"
            data-side="original"
            role="status"
          >
            {t('editor.loading')}
          </div>
        )}
        <MarkdownComparisonEditor
          tabId={tabId}
          side="modified"
          content={draftContent}
          filePath={modifiedPath}
          readOnly={!onDraftChange}
          layout={ready ? modifiedLayout : null}
          previewBoundsRef={previewBoundsRef}
          onDraftChange={onDraftChange}
          boundsRef={scrollRef}
          busy={busy}
          onReady={markCurrentReady}
        />
      </div>
    </div>
  );
}
