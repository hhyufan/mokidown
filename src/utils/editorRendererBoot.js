import { createElement, forwardRef, lazy, useRef } from 'react';
import { importWithRetry } from './lazyWithRetry';
import { preloadMonacoEditor } from './monacoRuntimeBoot';

let milkdownRequest;
let loadedMilkdown;
let historyRequest;
const HISTORY_MODULE_TIMEOUT_MS = 15000;

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
      PendingMilkdownEditor = lazy(loadMilkdownEditor);
      throw error;
    });
  return milkdownRequest;
}

let PendingMilkdownEditor = lazy(loadMilkdownEditor);

export const MilkdownEditor = forwardRef(function MilkdownEditor(props, ref) {
  // Keep the resolved component type stable for each mounted document.
  const Editor = useRef(loadedMilkdown ?? PendingMilkdownEditor).current;
  return createElement(Editor, { ...props, ref });
});

export function loadHistoryDiffView() {
  if (historyRequest) return historyRequest;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('Timed out loading the comparison module')),
      HISTORY_MODULE_TIMEOUT_MS,
    );
  });
  historyRequest = Promise.race([
    importWithRetry(() => import('../components/history/HistoryDiffView')),
    deadline,
  ])
    .finally(() => clearTimeout(timer))
    .catch((error) => {
      historyRequest = undefined;
      throw error;
    });
  return historyRequest;
}

export function prepareComparisonRenderer(rendered) {
  void loadHistoryDiffView().catch(() => {});
  void (rendered ? loadMilkdownEditor() : preloadMonacoEditor()).catch(() => {});
}
