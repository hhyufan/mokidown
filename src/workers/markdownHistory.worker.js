import { DefaultLinesDiffComputer } from 'monaco-editor/esm/vs/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.js';
import { alignBlocks, parseDocument } from '../components/history/markdownHistoryModel';

const diffComputer = new DefaultLinesDiffComputer();
let original;

self.onmessage = ({ data }) => {
  if ('original' in data) {
    original = parseDocument(data.original);
    return;
  }

  const modified = parseDocument(data.modified);
  if (original.key === modified.key) {
    self.postMessage({ identical: true });
    return;
  }

  const { changes } = diffComputer.computeDiff(original.lines, modified.lines, {
    ignoreTrimWhitespace: false,
    computeMoves: false,
    maxComputationTimeMs: 1000,
  });
  const lineChanges = changes.map((change) => ({
    originalStartLineNumber: change.original.startLineNumber - Number(change.original.isEmpty),
    originalEndLineNumber: change.original.isEmpty ? 0 : change.original.endLineNumberExclusive - 1,
    modifiedStartLineNumber: change.modified.startLineNumber - Number(change.modified.isEmpty),
    modifiedEndLineNumber: change.modified.isEmpty ? 0 : change.modified.endLineNumberExclusive - 1,
  }));
  self.postMessage({
    rows: alignBlocks(original, modified, lineChanges),
    originalBlocks: original.anchors,
    modifiedBlocks: modified.anchors,
  });
};
