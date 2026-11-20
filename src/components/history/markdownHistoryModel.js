import { markdownBlockKey, parseMarkdownBlocks } from '../editor/markdownSections';
import { historyAddition } from '../../utils/historyChanges';

export function parseDocument(source) {
  const lines = source.split(/\r\n|\r|\n/);
  const blocks = parseMarkdownBlocks(source);
  const anchors = blocks
    .filter(({ type }) => type !== 'definition')
    .map((block) => ({
      start: block.position.start.line,
      end: block.position.end.line,
      empty: block.type === 'paragraph' && !block.children.length,
    }));
  return { lines, blocks, anchors, key: markdownBlockKey(blocks) };
}

function alignLines(changes, originalLength, modifiedLength) {
  const slots = [];
  const originalSlots = [];
  const modifiedSlots = [];
  let left = 0;
  let right = 0;
  const add = (leftLength, rightLength, change = null) => {
    for (let offset = 0; offset < Math.max(leftLength, rightLength); offset++) {
      const original = offset < leftLength ? left++ : null;
      const modified = offset < rightLength ? right++ : null;
      if (original != null) originalSlots[original] = slots.length;
      if (modified != null) modifiedSlots[modified] = slots.length;
      slots.push({ original, modified, change });
    }
  };
  for (const change of changes) {
    const {
      originalStartLineNumber: os,
      originalEndLineNumber: oe,
      modifiedStartLineNumber: ms,
      modifiedEndLineNumber: me,
    } = change;
    // In Monaco, an empty range points at the line before the insertion/deletion.
    add((oe ? os - 1 : os) - left, (me ? ms - 1 : ms) - right);
    add(oe ? oe - os + 1 : 0, me ? me - ms + 1 : 0, change);
  }
  add(originalLength - left, modifiedLength - right);
  return { slots, originalSlots, modifiedSlots };
}

export function alignBlocks(left, right, changes) {
  const { slots, originalSlots, modifiedSlots } = alignLines(
    changes,
    left.lines.length,
    right.lines.length,
  );
  const blockEnds = [];
  const originalBlocks = [];
  const modifiedBlocks = [];
  for (const [document, lineSlots, blocksBySlot] of [
    [left, originalSlots, originalBlocks],
    [right, modifiedSlots, modifiedBlocks],
  ]) {
    for (const block of document.blocks) {
      const { position } = block;
      const start = lineSlots[position.start.line - 1];
      const end = lineSlots[position.end.line - 1];
      blockEnds[start] = Math.max(blockEnds[start] ?? start, end);
      (blocksBySlot[start] ??= []).push(block);
    }
  }
  // Treat a continuous missing range as one row so its hatch spans every block.
  for (let start = 0; start < slots.length; start++) {
    const missing = slots[start].original == null ? 'original' : 'modified';
    if (slots[start][missing] != null) continue;
    let end = start;
    while (end + 1 < slots.length && slots[end + 1][missing] == null) end++;
    blockEnds[start] = Math.max(blockEnds[start] ?? start, end);
    start = end;
  }

  const rows = [];
  const seenChanges = new Set();
  const additions = new Map(changes.map((change) => [change, historyAddition(change)]));
  for (let start = 0; start < slots.length;) {
    const candidateActions = new Map();
    const oldBlocks = [];
    const newBlocks = [];
    let changed = false;
    let removed = false;
    let added = false;
    let firstOriginal;
    let lastOriginal;
    let firstModified;
    let lastModified;
    let hasContent = false;
    let end = start;
    // Close over blocks from both documents so neither side is split mid-block.
    for (let i = start; i <= end; i++) {
      end = Math.max(end, blockEnds[i] ?? i);
      const slot = slots[i];
      if (originalBlocks[i]) oldBlocks.push(...originalBlocks[i]);
      if (modifiedBlocks[i]) newBlocks.push(...modifiedBlocks[i]);
      if (slot.original != null) {
        firstOriginal ??= slot.original + 1;
        lastOriginal = slot.original + 1;
      }
      if (slot.modified != null) {
        hasContent ||= Boolean(right.lines[slot.modified].trim());
        firstModified ??= slot.modified + 1;
        lastModified = slot.modified + 1;
      }
      if (!slot.change) continue;
      changed = true;
      removed ||= slot.original != null;
      added ||= slot.modified != null;
      if (slot.change.originalEndLineNumber && !seenChanges.has(slot.change)) {
        candidateActions.set(slot.change, 'right');
      }
      const addition = additions.get(slot.change);
      if (
        addition &&
        slot.modified != null &&
        slot.modified + 1 === addition.modifiedStartLineNumber
      ) {
        candidateActions.set(addition, 'left');
      }
    }
    changed &&= markdownBlockKey(oldBlocks) !== markdownBlockKey(newBlocks);
    const actions = [];
    if (changed)
      for (const [change, direction] of candidateActions) {
        if (seenChanges.has(change)) continue;
        seenChanges.add(change);
        actions.push({ change, direction });
      }
    if (changed || firstModified != null)
      rows.push({
        key: start,
        firstOriginal,
        lastOriginal,
        firstModified,
        lastModified,
        hasContent,
        changed,
        removed: changed && removed,
        added: changed && added,
        originalGap: changed && firstOriginal == null,
        modifiedGap: changed && firstModified == null,
        actions,
      });
    start = end + 1;
  }
  return rows;
}
