import { HOTKEY_ACTION_MAP, isCapturingShortcut } from '@/configs/hotkeys';
import { getResolvedHotkeys, matchesHotkey, replacedHotkey } from '@hooks/useHotkeys';
import { isImeComposing } from '@utils/keyboard';
import { formatKeybinding } from '@utils/keybinding';
import { readMenuClipboardText } from '@utils/menuClipboard';

const ids = ['editCut', 'editCopy', 'editPaste', 'editSelectAll', 'editUndo', 'editRedo'];

export function editingShortcutOf(key) {
  const id = `edit${key[0].toUpperCase()}${key.slice(1)}`;
  const keybinding = getResolvedHotkeys()[id] ?? '';
  return { keybinding, shortcut: formatKeybinding(keybinding) };
}

export function handleEditingShortcut(event, run) {
  if (event.defaultPrevented || isCapturingShortcut() || isImeComposing(event)) return false;
  const id = matchesHotkey(event, ...ids);
  if (id) {
    const key = id.slice(4);
    const custom = getResolvedHotkeys()[id] !== HOTKEY_ACTION_MAP.get(id).defaultKeybinding;
    if (run(key[0].toLowerCase() + key.slice(1), custom) !== true) return false;
  } else if (!replacedHotkey(event, ...ids)) {
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  return true;
}

export function runTextFieldShortcut(target, action, custom) {
  if (!custom) return false;
  if (action === 'paste') {
    const document = target.ownerDocument;
    const value = target.value;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    void readMenuClipboardText().then((text) => {
      if (text && document.activeElement === target && target.value === value &&
        target.selectionStart === start && target.selectionEnd === end) {
        document.execCommand('insertText', false, text);
      }
    }).catch(() => {});
  } else {
    target.ownerDocument.execCommand(action === 'selectAll' ? 'selectAll' : action);
  }
  return true;
}
