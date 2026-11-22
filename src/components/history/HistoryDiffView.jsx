import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Tooltip } from 'antd';
import { CheckOutlined, CloseOutlined, HistoryOutlined } from '@ant-design/icons';
import useHistoryStore, { isMarkdownComparison } from '@store/useHistoryStore';
import useEditorStore from '@store/useEditorStore';
import useThemeStore from '@store/useThemeStore';
import { installIndentRainbow } from '@utils/monacoIndentRainbow';
import useConfigStore from '@store/useConfigStore';
import useNotificationStore from '@store/useNotificationStore';
import { useFileManager } from '@hooks/useFileManager';
import { broadcastToPlugins, executePluginCommand, sendToPlugin } from '@utils/pluginBus';
import { getBuffer, flushEditorBuffer } from '@utils/editorBuffer';
import {
  clearMarkdownUndo,
  markdownUndoDirection,
  markdownUndoStep,
  recordMarkdownEdit,
} from '@utils/markdownUndo';
import { sha256 } from '../../../shared/plugin-package.mjs';
import { historyCapture } from '@utils/tauriApi';
import { getFileLanguage } from '@utils/fileLanguage';
import {
  hasSelectedHistoryChanges,
  historyAddition,
  restoreSelectedHistoryChanges,
} from '@utils/historyChanges';
import { mountHistorySourceArrows } from './historySourceArrows';
import { mountHistorySourceFoldLabels } from './historySourceFoldLabels';
import MokiStatusEmpty from '@components/moki/MokiStatusEmpty';
import MilkdownTooltips from '@components/editor/MilkdownTooltips';
import MarkdownHistoryDiff, {
  HISTORY_FOLD_CONTEXT,
  HISTORY_FOLD_MINIMUM,
} from './MarkdownHistoryDiff';
import { useMarkdownHistoryComparison } from './useMarkdownHistoryComparison';
import './history.scss';

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleString();
}

const normalizeLines = (text) => text.replace(/\r\n|\r/g, '\n');
const NO_CHANGES = [];
const defaultFoldState = () => ({ defaultExpanded: false, overrides: new Map() });

async function captureAppliedHistory(path, previousContent, content, restoredFrom, onError) {
  if (!path || /^[a-z][a-z\d+.-]*:\/\//i.test(path)) return;
  let accessDenied = false;
  const capture = async (...args) => {
    try {
      return (await historyCapture(...args)) !== false || !args[2]?.force;
    } catch (error) {
      const detail = error?.message || String(error);
      accessDenied ||= /\bos error (?:5|13)\b|access is denied|permission denied|拒绝访问/i.test(
        detail,
      );
      console.warn('[history] snapshot failed:', error);
      return false;
    }
  };
  const previousSaved = await capture(path, previousContent);
  const latestSaved = await capture(path, content, {
    force: true,
    ...(restoredFrom !== undefined ? { restoredFrom } : {}),
  });
  if (previousSaved || latestSaved) useHistoryStore.getState().notifyHistoryWrite(path);
  if (!previousSaved || !latestSaved)
    onError(accessDenied ? 'history.snapshotAccessDenied' : 'history.snapshotFailed');
}

function MonacoHistoryDiff({
  original,
  modified,
  fileName,
  theme,
  fontSize,
  fontFamily,
  lineHeight,
  tabSize,
  arrowLabels,
  busy,
  noChanges,
  initiallyExpanded,
  onDraftChange,
  onSelectionReady,
  onSplitChange,
  onDiffComputed,
  apiRef,
}) {
  const { t } = useTranslation();
  const containerRef = useRef(null);
  const diffRef = useRef(null);
  const originalModelRef = useRef(null);
  const modifiedModelRef = useRef(null);
  const runtimeRef = useRef(null);
  const foldLabelsRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const updatingRef = useRef(false);
  const latestRef = useRef(null);

  const language = useMemo(() => getFileLanguage(fileName || ''), [fileName]);
  const mono = useMemo(() => `'${fontFamily}', 'Fira Code', Consolas, monospace`, [fontFamily]);
  latestRef.current = {
    original,
    modified,
    language,
    t,
    theme,
    fontSize,
    mono,
    lineHeight,
    tabSize,
    arrowLabels,
    busy,
    initiallyExpanded,
    onDraftChange,
    onSelectionReady,
    onSplitChange,
    onDiffComputed,
  };

  useEffect(() => {
    if (!containerRef.current) return undefined;
    let cancelled = false;
    const listeners = [];
    Promise.all([import('monaco-editor'), import('@utils/monacoShiki')])
      .then(async ([monaco, { initMonacoShiki, getMonacoThemeName }]) => {
        if (cancelled) return;
        await initMonacoShiki();
        if (cancelled || !containerRef.current) return;
        runtimeRef.current = { monaco, getMonacoThemeName };
        const props = latestRef.current;
        const diff = monaco.editor.createDiffEditor(containerRef.current, {
          theme: getMonacoThemeName(props.theme === 'dark'),
          automaticLayout: true,
          readOnly: props.busy,
          originalEditable: false,
          renderSideBySide: true,
          useInlineViewWhenSpaceIsLimited: false,
          renderOverviewRuler: false,
          overviewRulerBorder: false,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          renderLineHighlight: 'none',
          glyphMargin: true,
          renderMarginRevertIcon: false,
          renderGutterMenu: false,
          folding: false,
          lineNumbers: 'on',
          wordWrap: 'on',
          diffWordWrap: 'on',
          renderWhitespace: 'boundary',
          tabSize: props.tabSize,
          fontSize: props.fontSize,
          fontFamily: props.mono,
          lineHeight: props.lineHeight,
          diffAlgorithm: 'advanced',
          ignoreTrimWhitespace: false,
          hideUnchangedRegions: {
            enabled: true,
            contextLineCount: HISTORY_FOLD_CONTEXT,
            minimumLineCount: HISTORY_FOLD_MINIMUM,
            revealLineCount: 2,
          },
          scrollbar: {
            verticalScrollbarSize: 6,
            horizontal: 'hidden',
            horizontalScrollbarSize: 0,
            useShadows: false,
          },
        });
        diffRef.current = diff;
        const originalModel = monaco.editor.createModel(props.original, props.language);
        originalModelRef.current = originalModel;
        const modifiedModel = monaco.editor.createModel(props.modified, props.language);
        modifiedModelRef.current = modifiedModel;
        const originalEditor = diff.getOriginalEditor(),
          modifiedEditor = diff.getModifiedEditor();
        listeners.push({
          dispose: installIndentRainbow(originalEditor, monaco),
        });
        listeners.push({
          dispose: installIndentRainbow(modifiedEditor, monaco),
        });
        const arrows = modifiedEditor.onDidScrollChange
          ? mountHistorySourceArrows(containerRef.current, modifiedEditor)
          : null;
        if (arrows) listeners.push(arrows);
        const updateSplit = () => {
          if (cancelled || !containerRef.current) return;
          const offset =
            modifiedEditor.getContainerDomNode().getBoundingClientRect().left -
            containerRef.current.getBoundingClientRect().left;
          if (offset > 0) latestRef.current.onSplitChange(offset);
        };
        listeners.push(originalEditor.onDidLayoutChange(updateSplit));
        listeners.push(modifiedEditor.onDidLayoutChange(updateSplit));
        let side = 'modified';
        let computedVersion = -1;
        let computed;
        let expandInitial = props.initiallyExpanded;
        const reportComparison = () => {
          if (!computed || computedVersion !== modifiedModel.getVersionId()) return;
          const regions = diff.saveViewState?.()?.modelState?.collapsedRegions;
          const folds = Array.isArray(regions)
            ? regions.map(({ range }) => range).filter(([start, end]) => end > start)
            : null;
          latestRef.current.onDiffComputed({
            ...computed,
            folds,
            foldableCount: regions?.length ?? 0,
          });
        };
        if (modifiedEditor.onDidChangeHiddenAreas) {
          listeners.push(modifiedEditor.onDidChangeHiddenAreas(reportComparison));
        }
        const getSelection = () =>
          (side === 'original' ? originalEditor : modifiedEditor).getSelection();
        const updateSelectionReady = () => {
          latestRef.current.onSelectionReady(
            computedVersion === modifiedModel.getVersionId() &&
              hasSelectedHistoryChanges(diff.getLineChanges(), getSelection(), side),
          );
        };
        for (const [name, editor] of [
          ['original', originalEditor],
          ['modified', modifiedEditor],
        ]) {
          listeners.push(
            editor.onDidFocusEditorText(() => {
              side = name;
              updateSelectionReady();
            }),
            editor.onDidChangeCursorSelection(() => {
              if (side === name) updateSelectionReady();
            }),
          );
        }
        listeners.push(
          originalModel.onDidChangeContent(() => {
            computedVersion = -1;
            arrows?.update([]);
            latestRef.current.onSelectionReady(false);
          }),
        );
        listeners.push(
          modifiedModel.onDidChangeContent(() => {
            arrows?.update([]);
            latestRef.current.onSelectionReady(false);
            if (!updatingRef.current) latestRef.current.onDraftChange(modifiedModel.getValue());
          }),
        );
        listeners.push(
          diff.onDidUpdateDiff(() => {
            const changes = diff.getLineChanges();
            computedVersion = modifiedModel.getVersionId();
            updateArrows(changes);
            updateSelectionReady();
            computed = changes && {
              original: normalizeLines(originalModel.getValue()),
              modified: normalizeLines(modifiedModel.getValue()),
              changes,
            };
            if (computed && expandInitial) {
              expandInitial = false;
              diff.showAllUnchangedRegions?.();
            }
            reportComparison();
          }),
        );
        const restore = (changes, selection, selectedSide) => {
          if (latestRef.current.busy || computedVersion !== modifiedModel.getVersionId()) return;
          const content = restoreSelectedHistoryChanges(
            originalModel.getValue(),
            modifiedModel.getValue(),
            changes,
            selection,
            selectedSide,
          );
          if (content === modifiedModel.getValue()) return;
          modifiedEditor.pushUndoStop();
          modifiedEditor.executeEdits('history-selection', [
            { range: modifiedModel.getFullModelRange(), text: content },
          ]);
          modifiedEditor.pushUndoStop();
        };
        const restoreChange = (change) => {
          const originalSide = !change.modifiedEndLineNumber;
          const startLineNumber = originalSide
            ? change.originalStartLineNumber
            : change.modifiedStartLineNumber;
          const endLineNumber = originalSide
            ? change.originalEndLineNumber
            : change.modifiedEndLineNumber;
          restore(
            [change],
            { startLineNumber, endLineNumber, endColumn: Infinity },
            originalSide ? 'original' : 'modified',
          );
        };
        const updateArrows = (changes) => {
          if (!arrows) return;
          const { arrowLabels: labels, busy: locked } = latestRef.current;
          arrows.update(
            locked
              ? []
              : (changes || []).flatMap((change) => {
                  const {
                    originalEndLineNumber: oe,
                    modifiedStartLineNumber: ms,
                    modifiedEndLineNumber: me,
                  } = change;
                  const actions = [];
                  if (oe)
                    actions.push({
                      line: ms,
                      after: !me,
                      direction: 'right',
                      label: labels.revert,
                      run: () => restoreChange(change),
                    });
                  const addition = historyAddition(change);
                  if (addition)
                    actions.push({
                      line: addition.modifiedStartLineNumber,
                      direction: 'left',
                      label: labels.remove,
                      run: () => restoreChange(addition),
                    });
                  return actions;
                }),
          );
        };
        apiRef.current = {
          refreshArrows() {
            if (computedVersion === modifiedModel.getVersionId())
              updateArrows(diff.getLineChanges());
          },
          setAllFolds(expanded) {
            if (expanded) diff.showAllUnchangedRegions?.();
            else diff.collapseAllUnchangedRegions?.();
            reportComparison();
          },
          getSelectedContent() {
            if (computedVersion !== modifiedModel.getVersionId()) return null;
            const changes = diff.getLineChanges();
            const selection = getSelection();
            if (!hasSelectedHistoryChanges(changes, selection, side)) return null;
            return restoreSelectedHistoryChanges(
              originalModel.getValue(),
              modifiedModel.getValue(),
              changes,
              selection,
              side,
            );
          },
          restoreChange,
        };
        diff.setModel({ original: originalModel, modified: modifiedModel });
        const foldLabels = mountHistorySourceFoldLabels(containerRef.current, (...args) =>
          latestRef.current.t(...args),
        );
        listeners.push(foldLabels);
        foldLabelsRef.current = foldLabels;
        updateSplit();
        setReady(true);
      })
      .catch((failure) => {
        if (!cancelled) setError(String(failure?.message || failure));
      });

    return () => {
      cancelled = true;
      listeners.forEach((listener) => listener.dispose());
      apiRef.current = null;
      diffRef.current?.dispose();
      originalModelRef.current?.dispose();
      modifiedModelRef.current?.dispose();
      diffRef.current = null;
      runtimeRef.current = null;
      foldLabelsRef.current = null;
      originalModelRef.current = null;
      modifiedModelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    updatingRef.current = true;
    try {
      if (originalModelRef.current && originalModelRef.current.getValue() !== original)
        originalModelRef.current.setValue(original);
      if (modifiedModelRef.current && modifiedModelRef.current.getValue() !== modified)
        modifiedModelRef.current.setValue(modified);
    } finally {
      updatingRef.current = false;
    }
  }, [original, modified]);

  useEffect(() => {
    const monaco = runtimeRef.current?.monaco;
    if (!monaco) return;
    if (originalModelRef.current)
      monaco.editor.setModelLanguage(originalModelRef.current, language);
    if (modifiedModelRef.current)
      monaco.editor.setModelLanguage(modifiedModelRef.current, language);
  }, [language]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime && diffRef.current)
      runtime.monaco.editor.setTheme(runtime.getMonacoThemeName(theme === 'dark'));
    diffRef.current?.updateOptions({
      readOnly: busy,
      fontSize,
      fontFamily: mono,
      lineHeight,
      tabSize,
    });
  }, [theme, busy, fontSize, mono, lineHeight, tabSize]);

  useEffect(() => {
    apiRef.current?.refreshArrows();
  }, [apiRef, arrowLabels, busy]);

  useEffect(() => {
    foldLabelsRef.current?.update();
  }, [t]);

  return (
    <>
      {error && (
        <div className="history-diff__error" role="alert">
          {error}
        </div>
      )}
      <div
        className="history-diff__editor"
        ref={containerRef}
        data-ready={ready}
        hidden={noChanges}
      />
      <MilkdownTooltips
        rootRef={containerRef}
        targetSelector=".fold-unchanged"
        labelKey="history.foldUnchangedRegion"
      />
    </>
  );
}

/**
 * 主编辑区的历史对比视图（VS Code 式：diff 覆盖编辑区，关闭后回到正文）。
 *
 * 左侧 = 历史版本，右侧 = 当前内容；顶部横栏提供「关闭对比」与「恢复此版本」。
 */
export default function HistoryDiffView() {
  const { t } = useTranslation();
  const revertLabel = t('history.revertChange');
  const removeLabel = t('history.revertAddition');
  const arrowLabels = useMemo(
    () => ({ revert: revertLabel, remove: removeLabel }),
    [revertLabel, removeLabel],
  );
  const diff = useHistoryStore((s) => s.diff);
  const mode = useHistoryStore((s) => s.viewMode);
  const clearDiff = useHistoryStore((s) => s.clearDiff);
  const tabs = useEditorStore((s) => s.tabs);
  const theme = useThemeStore((s) => s.theme);
  const fontSize = useConfigStore((s) => s.fontSize);
  const fontFamily = useConfigStore((s) => s.fontFamily);
  const lineHeight = useConfigStore((s) => s.lineHeight);
  const tabSize = useConfigStore((s) => s.tabSize);
  const { saveTab } = useFileManager();

  const [pendingDiff, setPendingDiff] = useState(null);
  const busy = diff != null && pendingDiff === diff;
  const [draftState, setDraftState] = useState(null);
  const draftRef = useRef(null);
  const [selectionReady, setSelectionReady] = useState(false);
  const [historyHash, setHistoryHash] = useState(null);
  const [splitOffset, setSplitOffset] = useState(null);
  const [actionError, setActionError] = useState('');
  const [computedDiff, setComputedDiff] = useState(null);
  const [markdownFolds, setMarkdownFolds] = useState(defaultFoldState);
  const [markdownFoldSummary, setMarkdownFoldSummary] = useState({
    collapsedCount: 0,
    expandedCount: 0,
  });
  const editorRef = useRef(null);
  const comparisonBoundsRef = useRef(null);

  const tab = tabs.find((item) => item.id === diff?.tabId) || null;
  const pluginActions = diff?.pluginId && diff.actions?.length ? diff.actions : null;
  useEffect(() => {
    setDraftState(null);
    setSelectionReady(false);
    setActionError('');
    setMarkdownFolds(defaultFoldState());
    setMarkdownFoldSummary({ collapsedCount: 0, expandedCount: 0 });
  }, [diff, tab?.id]);
  useEffect(() => () => clearMarkdownUndo(diff), [diff]);
  const historyContent = diff?.content;
  useEffect(() => {
    if (historyContent == null) return undefined;
    let cancelled = false;
    Promise.resolve()
      .then(() => crypto.subtle.digest('SHA-256', new TextEncoder().encode(historyContent)))
      .then((digest) => {
        if (cancelled) return;
        const hash = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
        setHistoryHash({ content: historyContent, hash });
      })
      .catch((error) => console.warn('[history] hash failed:', error));
    return () => {
      cancelled = true;
    };
  }, [historyContent]);
  const current = tab ? getBuffer(tab.id, tab.content || '') : '';
  const draft = draftState?.comparison === diff ? draftState?.content : null;
  const modified = draft ?? current;
  const updateDraft = useCallback(
    (content) => {
      if (!diff || useHistoryStore.getState().diff !== diff) return;
      const previous = draftRef.current?.comparison === diff ? draftRef.current.content : current;
      if (previous === content) return;
      recordMarkdownEdit(diff, null, previous, content);
      draftRef.current = { comparison: diff, content };
      setDraftState(draftRef.current);
    },
    [current, diff],
  );
  useEffect(() => {
    if (!diff || busy) return undefined;
    const onKeyDown = (event) => {
      const direction = markdownUndoDirection(event);
      if (!direction || useHistoryStore.getState().diff !== diff) return;
      const target = event.target;
      if (
        target !== document.body &&
        !comparisonBoundsRef.current?.contains(target) &&
        !target.closest?.('.footer__mode-toggle')
      )
        return;
      if (target.closest?.('input, textarea, select') && !target.closest('.history-diff__editor'))
        return;
      const content = draftRef.current?.comparison === diff ? draftRef.current.content : current;
      const step = markdownUndoStep(diff, direction, content);
      event.preventDefault();
      event.stopPropagation();
      if (!step) return;
      step.commit();
      draftRef.current = { comparison: diff, content: step.text };
      setDraftState(draftRef.current);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [busy, current, diff]);
  const rendered = mode === 'preview' && isMarkdownComparison(tab, diff);
  // Monaco 按行比较，不把 CRLF/LF 的差别当成代码修改。
  const originalText = normalizeLines(historyContent ?? '');
  const modifiedText = normalizeLines(modified);
  const identical = originalText === modifiedText;
  const renderedDiff = identical
    ? { modified: modifiedText, changes: NO_CHANGES, folds: NO_CHANGES }
    : computedDiff?.original === originalText
      ? computedDiff
      : null;
  const preview = useMarkdownHistoryComparison(originalText, modifiedText, rendered, draft != null);
  const currentDiff = (rendered ? preview : renderedDiff)?.modified === modifiedText;
  const noChanges = identical || (rendered && currentDiff && Boolean(preview?.identical));
  const showEmpty = noChanges && (!rendered || draft == null);
  if (!diff || !tab) return null;

  const hash = historyHash?.content === diff.content ? historyHash.hash : '';
  const hasDraft = draft != null && modifiedText !== normalizeLines(current);
  const applySelection = !hasDraft && !rendered && !noChanges && selectionReady;
  const applyLabel = t(applySelection ? 'history.applySelectedChanges' : 'history.applyChanges');
  const canExpand =
    !showEmpty &&
    currentDiff &&
    (rendered ? markdownFoldSummary.collapsedCount > 0 : Boolean(renderedDiff?.folds?.length));
  const canCollapse =
    !showEmpty &&
    currentDiff &&
    (rendered ? markdownFoldSummary.expandedCount > 0 : Boolean(renderedDiff?.foldableCount));
  const setAllFolds = (expanded) => {
    setMarkdownFolds({ ...defaultFoldState(), defaultExpanded: expanded });
    editorRef.current?.setAllFolds(expanded);
  };

  const revertPreviewChange = (change) => {
    if (!currentDiff || busy) return;
    const fromHistory = !change.modifiedEndLineNumber;
    const startLineNumber = fromHistory
      ? change.originalStartLineNumber
      : change.modifiedStartLineNumber;
    const endLineNumber = fromHistory ? change.originalEndLineNumber : change.modifiedEndLineNumber;
    updateDraft(
      restoreSelectedHistoryChanges(
        diff.content,
        modified,
        [change],
        {
          startLineNumber,
          endLineNumber,
          endColumn: Infinity,
        },
        fromHistory ? 'original' : 'modified',
      ),
    );
  };

  const saveChanges = async (content, rollback = false) => {
    if (busy || useHistoryStore.getState().diff !== diff) return;
    setPendingDiff(diff);
    setActionError('');
    try {
      const result = await saveTab(tab.id, { replacement: content });
      if (!result?.ok) {
        if (!result?.cancelled && useHistoryStore.getState().diff === diff) {
          setActionError(
            result?.message ||
              t(result?.conflict ? 'history.applyConflict' : 'history.applyFailed'),
          );
        }
        return;
      }
      const path = result.path ?? tab.path;
      const saved = result.savedContent ?? content;
      clearDiff(diff);
      void captureAppliedHistory(
        path,
        result.previousContent ?? current,
        saved,
        rollback ? diff.timestamp : undefined,
        (messageKey) => {
          useNotificationStore.getState().notify('warning', t('history.title'), t(messageKey));
        },
      );
      // Generic notification: the plugin that opened the comparison decides
      // what to do with the applied content.
      broadcastToPlugins({ type: 'event', name: 'diffApplied', payload: { path, content: saved } });
    } catch (error) {
      console.warn('[history] restore failed:', error);
      if (useHistoryStore.getState().diff === diff) setActionError(t('history.applyFailed'));
    } finally {
      setPendingDiff((pending) => (pending === diff ? null : pending));
    }
  };

  const runPluginAction = async (action) => {
    if (busy || useHistoryStore.getState().diff !== diff) return;
    setPendingDiff(diff);
    setActionError('');
    try {
      flushEditorBuffer(tab.id);
      const content = getBuffer(tab.id, tab.content || '');
      const currentTab = useEditorStore.getState().tabs.find((item) => item.id === tab.id);
      if (currentTab?.modified || content !== currentTab?.content) {
        const result = await saveTab(tab.id);
        if (!result?.ok) throw new Error('Document could not be saved');
      }
      await executePluginCommand(diff.pluginId, action.command, {
        ...action.args,
        document: { id: tab.id, path: tab.path, content, checksum: await sha256(content) },
        draftContent: draft ?? content,
        referenceContent: diff.content,
      });
      clearDiff(diff);
    } catch (error) {
      if (useHistoryStore.getState().diff === diff) setActionError(String(error?.message || error));
    } finally {
      setPendingDiff((pending) => (pending === diff ? null : pending));
    }
  };

  return (
    <div className="history-diff" ref={comparisonBoundsRef}>
      <header className="history-diff__bar">
        <span className="history-diff__title">{diff.label || t('history.title')}</span>
        <div className="history-diff__actions">
          {[true, false].map((expanded) => {
            const label = t(
              expanded ? 'history.expandAllUnchanged' : 'history.collapseAllUnchanged',
            );
            return (
              <Tooltip key={String(expanded)} title={label} placement="top" mouseEnterDelay={0.3}>
                <span className="history-diff__action">
                  <Button
                    size="small"
                    className="history-diff__fold-button"
                    aria-label={label}
                    icon={
                      <span
                        className={`codicon codicon-${expanded ? 'unfold' : 'fold'}`}
                        aria-hidden="true"
                      />
                    }
                    disabled={busy || !(expanded ? canExpand : canCollapse)}
                    onClick={() => setAllFolds(expanded)}
                  />
                </span>
              </Tooltip>
            );
          })}
          <Tooltip title={t('history.closeDiff')} placement="top" mouseEnterDelay={0.3}>
            <span className="history-diff__action">
              <Button
                size="small"
                aria-label={t('history.closeDiff')}
                icon={<CloseOutlined aria-hidden="true" />}
                disabled={busy}
                onClick={() => {
                  if (useHistoryStore.getState().diff !== diff) return;
                  clearDiff(diff);
                  if (diff.pluginId)
                    sendToPlugin(diff.pluginId, {
                      type: 'event',
                      name: 'diffClosed',
                      payload: { path: tab.path },
                    });
                }}
              />
            </span>
          </Tooltip>
          {pluginActions ? (
            pluginActions.map((action) => (
              <Button
                key={action.id}
                size="small"
                disabled={busy || action.disabled}
                type={action === pluginActions.at(-1) ? 'primary' : 'default'}
                onClick={() => runPluginAction(action)}
              >
                {action.title}
              </Button>
            ))
          ) : (
            <>
              <Tooltip title={applyLabel} placement="top" mouseEnterDelay={0.3}>
                <span className="history-diff__action">
                  <Button
                    type="primary"
                    size="small"
                    aria-label={applyLabel}
                    icon={<CheckOutlined aria-hidden="true" />}
                    loading={busy}
                    disabled={busy || (!hasDraft && !applySelection)}
                    onClick={() => {
                      const content = applySelection
                        ? editorRef.current?.getSelectedContent()
                        : draft;
                      if (content != null && content !== current) void saveChanges(content);
                    }}
                  />
                </span>
              </Tooltip>
              <Tooltip
                title={diff.actionLabel || t('history.restore')}
                placement="top"
                mouseEnterDelay={0.3}
              >
                <span className="history-diff__action">
                  <Button
                    size="small"
                    aria-label={diff.actionLabel || t('history.restore')}
                    icon={<HistoryOutlined aria-hidden="true" />}
                    disabled={busy}
                    onClick={() => saveChanges(diff.content, !diff.label)}
                  />
                </span>
              </Tooltip>
            </>
          )}
        </div>
      </header>
      {actionError && (
        <div className="history-diff__error" role="alert">
          {actionError}
        </div>
      )}
      <div
        className={
          rendered ? 'history-diff__files history-diff__files--preview' : 'history-diff__files'
        }
        style={{ '--history-split': rendered || splitOffset == null ? '50%' : `${splitOffset}px` }}
      >
        <div className="history-diff__file" role="group" aria-label={t('history.title')}>
          <span className="history-diff__filename">{tab.name}</span>
          {hash && (
            <Tooltip title={`SHA-256: ${hash}`} placement="top" mouseEnterDelay={0.3}>
              <code className="history-diff__hash">{hash.slice(0, 8)}</code>
            </Tooltip>
          )}
          <time dateTime={new Date(diff.timestamp).toISOString()}>
            {formatTime(diff.timestamp)}
          </time>
        </div>
        <div className="history-diff__file" role="group" aria-label={t('history.current')}>
          <span className="history-diff__filename">{tab.name}</span>
          <span className="history-diff__version">{t('history.current')}</span>
        </div>
      </div>
      {showEmpty && (
        /*
         * 所选版本与当前内容一致时，不必只丢一行冷冰冰的「没有更改」——
         * 用与文件树 / 提纲同一套空状态：角色立绘 + 一句 ACG 口吻的主句 + 淡色说明。
         */
        <div className="history-diff__empty" role="status">
          <MokiStatusEmpty
            art="history"
            title={t('empty.historyDiff.title')}
            hint={t('empty.historyDiff.hint')}
          />
        </div>
      )}
      {rendered && !showEmpty && !preview?.layout && (
        <div className="history-diff__error" role={preview?.error ? 'alert' : 'status'}>
          {preview?.error ? `${t('editor.loadFailed')} ${preview.error}` : t('editor.loading')}
        </div>
      )}
      {rendered && preview?.layout && (
        <MarkdownHistoryDiff
          key={`${tab.id}:${diff.timestamp}`}
          tabId={tab.id}
          original={diff.content}
          draftContent={modified}
          comparison={preview.layout}
          previewBoundsRef={comparisonBoundsRef}
          hidden={showEmpty}
          foldState={markdownFolds}
          ready={currentDiff}
          busy={busy}
          onRevert={revertPreviewChange}
          onDraftChange={updateDraft}
          onFoldSummary={setMarkdownFoldSummary}
          onToggleFold={({ key }, expanded) => {
            setMarkdownFolds((state) => ({
              ...state,
              overrides: new Map(state.overrides).set(key, expanded),
            }));
          }}
        />
      )}
      {!rendered && (
        <MonacoHistoryDiff
          key={`${tab.id}:${diff.timestamp}`}
          original={diff.content}
          modified={modified}
          fileName={tab.name}
          theme={theme}
          fontSize={fontSize}
          fontFamily={fontFamily}
          lineHeight={lineHeight}
          tabSize={tabSize}
          arrowLabels={arrowLabels}
          busy={busy}
          noChanges={noChanges}
          initiallyExpanded={markdownFolds.defaultExpanded}
          onDraftChange={updateDraft}
          onSelectionReady={setSelectionReady}
          onSplitChange={setSplitOffset}
          onDiffComputed={setComputedDiff}
          apiRef={editorRef}
        />
      )}
    </div>
  );
}
