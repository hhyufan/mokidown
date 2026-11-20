function* selectedRanges(changes, selection, side) {
  if (!selection || !changes?.length) return;
  const selectedStart = selection.startLineNumber;
  // A selection ending at column 1 excludes that final line.
  const selectedEnd =
    selection.endLineNumber > selectedStart && selection.endColumn === 1
      ? selection.endLineNumber - 1
      : selection.endLineNumber;
  for (const change of changes) {
    const start =
      side === 'original' ? change.originalStartLineNumber : change.modifiedStartLineNumber;
    const end = side === 'original' ? change.originalEndLineNumber : change.modifiedEndLineNumber;
    if (!end) continue;
    const from = Math.max(selectedStart, start);
    const to = Math.min(selectedEnd, end);
    if (from <= to) yield { change, start, from, to };
  }
}

export function historyAddition(change) {
  const {
    originalStartLineNumber,
    originalEndLineNumber,
    modifiedStartLineNumber,
    modifiedEndLineNumber,
  } = change;
  const paired = originalEndLineNumber ? originalEndLineNumber - originalStartLineNumber + 1 : 0;
  const firstAdded = modifiedStartLineNumber + paired;
  if (!modifiedEndLineNumber || firstAdded > modifiedEndLineNumber) return null;
  return { ...change, originalEndLineNumber: 0, modifiedStartLineNumber: firstAdded };
}

export function hasSelectedHistoryChanges(changes, selection, side) {
  if (
    !selection ||
    (selection.startLineNumber === selection.endLineNumber &&
      selection.startColumn === selection.endColumn)
  )
    return false;
  return !selectedRanges(changes, selection, side).next().done;
}

/** Restore selected lines/blocks while preserving every other current-file change. */
export function restoreSelectedHistoryChanges(
  original,
  modified,
  changes,
  selection,
  side = 'modified',
) {
  if (!selection || !changes?.length) return modified;
  const originalLines = original.split(/\r\n|\r|\n/);
  const modifiedLines = modified.split(/\r\n|\r|\n/);
  const eol = modified.includes('\r\n') ? '\r\n' : modified.includes('\r') ? '\r' : '\n';
  const edits = [];
  for (const { change, start, from, to } of selectedRanges(changes, selection, side)) {
    const os = change.originalStartLineNumber,
      oe = change.originalEndLineNumber;
    const ms = change.modifiedStartLineNumber,
      me = change.modifiedEndLineNumber;
    const originalCount = oe === 0 ? 0 : oe - os + 1;
    const modifiedCount = me === 0 ? 0 : me - ms + 1;
    if (originalCount === modifiedCount && originalCount > 0) {
      const offset = from - start,
        count = to - from + 1;
      edits.push({
        at: ms - 1 + offset,
        count,
        lines: originalLines.slice(os - 1 + offset, os - 1 + offset + count),
      });
    } else if (modifiedCount === 0 && side === 'original') {
      edits.push({ at: ms, count: 0, lines: originalLines.slice(from - 1, to) });
    } else if (originalCount === 0 && side === 'modified') {
      edits.push({ at: from - 1, count: to - from + 1, lines: [] });
    } else {
      edits.push({
        at: me === 0 ? ms : ms - 1,
        count: modifiedCount,
        lines: oe === 0 ? [] : originalLines.slice(os - 1, oe),
      });
    }
  }
  if (edits.length === 0) return modified;
  for (const edit of edits.sort((a, b) => b.at - a.at))
    modifiedLines.splice(edit.at, edit.count, ...edit.lines);
  return modifiedLines.join(eol);
}
