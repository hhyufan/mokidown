import { createElement, forwardRef, lazy, useRef } from 'react';
import { importWithRetry } from './lazyWithRetry';
import { preloadMonacoEditor } from './monacoRuntimeBoot';

let milkdownRequest;
let loadedMilkdown;
let historyRequest;

export const isMarkdownPath = (path) =>
  typeof path === 'string' && /\.(?:md|markdown|mdx)$/i.test(path);

export function loadMilkdownEditor() {
  milkdownRequest ??= importWithRetry(() => import('../components/editor/MilkdownMarkdownEditor'))
    .then((module) => {
      loadedMilkdown = module.default;
      return module;
    })
    .catch((error) => {
      milkdownRequest = undefined;
      throw error;
    });
  return milkdownRequest;
}

const PendingMilkdownEditor = lazy(loadMilkdownEditor);

export const MilkdownEditor = forwardRef(function MilkdownEditor(props, ref) {
  // Keep the resolved component type stable for each mounted document.
  const Editor = useRef(loadedMilkdown ?? PendingMilkdownEditor).current;
  return createElement(Editor, { ...props, ref });
});

export function loadHistoryDiffView() {
  historyRequest ??= importWithRetry(() => import('../components/history/HistoryDiffView')).catch(
    (error) => {
      historyRequest = undefined;
      throw error;
    },
  );
  return historyRequest;
}

export function prepareComparisonRenderer(rendered) {
  void loadHistoryDiffView().catch(() => {});
  void (rendered ? loadMilkdownEditor() : preloadMonacoEditor()).catch(() => {});
}
