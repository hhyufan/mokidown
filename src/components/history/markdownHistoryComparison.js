import { DefaultLinesDiffComputer } from 'monaco-editor/esm/vs/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.js';
import { alignBlocks, parseDocument } from './markdownHistoryModel';

/**
 * 与 markdownHistory.worker.js 共用同一套计算逻辑。没有 Worker 的环境
 * （例如 vitest/jsdom）直接走这里，保证对比视图仍可用。
 */
export function createMarkdownHistoryComparison(originalSource) {
  const original = parseDocument(originalSource);
  const diffComputer = new DefaultLinesDiffComputer();

  return (modifiedSource) => {
    const modified = parseDocument(modifiedSource);
    const { changes } = diffComputer.computeDiff(original.lines, modified.lines, {
      ignoreTrimWhitespace: false,
      computeMoves: false,
      maxComputationTimeMs: 1000,
    });
    const lineChanges = changes.map((change) => ({
      originalStartLineNumber: change.original.startLineNumber - Number(change.original.isEmpty),
      originalEndLineNumber: change.original.isEmpty
        ? 0
        : change.original.endLineNumberExclusive - 1,
      modifiedStartLineNumber: change.modified.startLineNumber - Number(change.modified.isEmpty),
      modifiedEndLineNumber: change.modified.isEmpty
        ? 0
        : change.modified.endLineNumberExclusive - 1,
    }));
    const rows = alignBlocks(original, modified, lineChanges);
    return {
      identical: !rows.some((row) => row.changed),
      rows,
      originalBlocks: original.anchors,
      modifiedBlocks: modified.anchors,
    };
  };
}
