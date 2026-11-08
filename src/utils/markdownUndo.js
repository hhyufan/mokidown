// Native stacks keep their selections and edit groups while an editor is
// mounted. This journal supplies the groups left behind when modes change.
const histories = new Map();
const maxGroups = 100;
const maxSourceCharacters = 4 * 1024 * 1024;
const sourceLength = (value) => typeof value === 'string' ? value.length : 0;

export function recordMarkdownEdit(tabId, group, before, after) {
  let history = histories.get(tabId);
  if (!history) {
    history = { entries: [], index: 0 };
    histories.set(tabId, history);
  }
  const { entries } = history;
  entries.splice(history.index);
  const last = entries.at(-1);
  if (last?.group === group && group != null) last.after = after;
  else entries.push({ group, before, after });
  let characters = 0;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    characters += sourceLength(entries[i].before) + sourceLength(entries[i].after);
    if (i < entries.length - 1 && (entries.length - i > maxGroups || characters > maxSourceCharacters)) {
      entries.splice(0, i + 1);
      break;
    }
  }
  history.index = entries.length;
}

export function noteNativeMarkdownUndo(tabId, direction) {
  const history = histories.get(tabId);
  if (!history) return;
  const index = history.index + direction;
  if (index < 0 || index > history.entries.length) histories.delete(tabId);
  else history.index = index;
}

export function markdownUndoStep(tabId, direction, current) {
  const history = histories.get(tabId);
  if (!history) return null;
  for (let index = history.index + direction; index >= 0 && index <= history.entries.length; index += direction) {
    const entry = history.entries[direction < 0 ? index : index - 1];
    const value = direction < 0 ? entry.before : entry.after;
    const text = typeof value === 'function' ? value() : value;
    if (text !== current) return { text, commit: () => { history.index = index; } };
  }
  return null;
}

export function hasMarkdownUndoStep(tabId, direction) {
  const history = histories.get(tabId);
  return Boolean(history && (direction < 0 ? history.index > 0 : history.index < history.entries.length));
}

export function clearMarkdownUndo(tabId) {
  histories.delete(tabId);
}

export function renameMarkdownUndo(from, to) {
  if (from === to) return;
  const history = histories.get(from);
  histories.delete(from);
  if (history) histories.set(to, history);
}

export function markdownUndoDirection(event) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
      event.altKey || event.ctrlKey === event.metaKey) return 0;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 1 : -1;
  if (key === 'y' && !event.shiftKey) return 1;
  return 0;
}
