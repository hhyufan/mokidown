import { useTranslation } from 'react-i18next';
import useNotificationStore from '@store/useNotificationStore';
import { formatJsonDocument } from '@utils/jsonDocument';
import { useHotkeys } from '@hooks/useHotkeys';
import { formatKeybinding } from '@utils/keybinding';
import { monacoEditingCommands, pasteMonacoClipboard } from './monacoImagePaste';
import { editingShortcutOf } from '@utils/basicEditingShortcuts';
import { openSnapshotPayload, readMonacoSnapshot, runQuickSnapshot } from '@utils/snapshotCapture';
import useEditorStore from '@store/useEditorStore';
import { MONACO_ACTION_IDS } from '@/services/monacoHotkeys';
import EditorContextMenu from './EditorContextMenu';

/**
 * Monaco 编辑器自定义右键菜单。
 * 仅负责菜单展示、关闭交互以及将菜单项映射到 Monaco 内建命令。
 */
export default function MonacoContextMenu({
  visible, x, y, onClose, editorRef, replayHistory, documentInfo, readOnly = false,
}) {
  const { t } = useTranslation();
  const { keybindingOf } = useHotkeys();
  const binding = (id) => {
    const keybinding = keybindingOf(id);
    return { keybinding, shortcut: formatKeybinding(keybinding) };
  };

  if (!visible) return null;

  // 统一通过 Monaco 的 command id 触发内建动作，避免在这里复制编辑逻辑。
  const trigger = (actionId) => () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const direction = actionId === 'undo' ? -1 : actionId === 'redo' ? 1 : 0;
    if (!direction || !replayHistory?.(direction)) editor.trigger('contextmenu', actionId, null);
  };

  const paste = async () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    await pasteMonacoClipboard(editor);
  };

  const json = editorRef.current?.getModel?.()?.getLanguageId?.() === 'json';
  const reflowJson = (mode) => () => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (model?.getLanguageId() !== 'json') return;
    try {
      const { tabSize, insertSpaces } = model.getOptions();
      const indentation = mode === 'minify' ? '' : insertSpaces ? ' '.repeat(tabSize) : '\t';
      const content = model.getValue();
      const formatted = formatJsonDocument(content, indentation);
      if (formatted !== content) {
        editor.pushUndoStop();
        editor.executeEdits('format-json', [{ range: model.getFullModelRange(), text: formatted }]);
        editor.pushUndoStop();
      }
      if (mode === 'expand') editor.trigger('contextmenu', 'editor.unfoldAll', null);
    } catch {
      useNotificationStore.getState().notify('error', t('editor.menu.invalidJson'), '');
    } finally {
      editor.focus();
    }
  };

  const buildSnapshotPayload = () => {
    const { tabs, activeTabId } = useEditorStore.getState();
    return readMonacoSnapshot(editorRef.current, documentInfo || tabs.find((entry) => entry.id === activeTabId));
  };

  // 菜单项顺序与常见编辑器右键菜单保持一致，分隔项仅用于视觉分组。
  const editing = (key, run = trigger(monacoEditingCommands[key])) => ({
    key, label: t(`editor.menu.${key}`), ...editingShortcutOf(key), run,
    disabled: readOnly && key !== 'copy' && key !== 'selectAll',
  });
  const command = (key, id, { run = trigger(MONACO_ACTION_IDS[id]), disabled = false } = {}) => ({
    key, label: t(`editor.menu.${key}`), ...binding(id), run, disabled,
  });
  const items = [
    editing('undo'),
    editing('redo'),
    { key: 's1', separator: true },
    editing('cut'),
    editing('copy'),
    editing('paste', paste),
    { key: 's2', separator: true },
    editing('selectAll'),
    { key: 'snapshot', label: t('editor.menu.snapshot'), ...binding('captureSnapshot'), runOnPress: true, run: () => openSnapshotPayload(buildSnapshotPayload()) },
    { key: 'quickSnapshot', label: t('editor.menu.quickSnapshot'), ...binding('quickSnapshot'), runOnPress: true, run: () => runQuickSnapshot(buildSnapshotPayload()) },
    { key: 's3', separator: true },
    command('find', 'findInEditor'),
    command('replace', 'replaceInEditor', { disabled: readOnly }),
    { key: 's4', separator: true },
    command('changeAllOccurrences', 'changeAllOccurrences', { disabled: readOnly }),
    command('formatDocument', 'formatDocument', { run: json ? reflowJson('format') : undefined, disabled: readOnly }),
    ...(json && !readOnly ? [
      { key: 'minify-json', label: t('editor.menu.minifyJson'), run: reflowJson('minify') },
      { key: 'expand-json', label: t('editor.menu.expandJson'), run: reflowJson('expand') },
    ] : []),
    { key: 's5', separator: true },
    command('commandPalette', 'commandPalette'),
  ];

  return <EditorContextMenu menu={{ x, y, items, variant: 'source' }} onClose={onClose} />;
}
