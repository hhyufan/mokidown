import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import useNotificationStore from '@store/useNotificationStore';
import { formatJsonDocument } from '@utils/jsonDocument';
import { useHotkeys } from '@hooks/useHotkeys';
import { formatKeybinding } from '@utils/keybinding';
import { monacoEditingCommands, pasteMonacoClipboard } from './monacoImagePaste';
import { editingShortcutOf } from '@utils/basicEditingShortcuts';
import { openSnapshotPayload, runQuickSnapshot } from '@utils/snapshotCapture';
import useEditorStore from '@store/useEditorStore';
import './monaco-context-menu.scss';

/**
 * Monaco 编辑器自定义右键菜单。
 * 仅负责菜单展示、关闭交互以及将菜单项映射到 Monaco 内建命令。
 */
export default function MonacoContextMenu({ visible, x, y, onClose, editorRef, replayHistory }) {
  const { t } = useTranslation();
  const { keybindingOf } = useHotkeys();
  const shortcutOf = (id) => formatKeybinding(keybindingOf(id));
  const menuRef = useRef(null);

  useEffect(() => {
    if (!visible) return;
    // 点击菜单外部或按下 Esc 时关闭菜单，行为与原生上下文菜单保持一致。
    const handlePointerDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [visible, onClose]);

  if (!visible) return null;

  // 统一通过 Monaco 的 command id 触发内建动作，避免在这里复制编辑逻辑。
  const trigger = (actionId) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClose();
    const editor = editorRef.current;
    if (!editor) return;
    const direction = actionId === 'undo' ? -1 : actionId === 'redo' ? 1 : 0;
    if (!direction || !replayHistory?.(direction)) editor.trigger('contextmenu', actionId, null);
    setTimeout(() => editor.focus(), 50);
  };

  const paste = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClose();
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    try {
      await pasteMonacoClipboard(editor);
    } catch (error) {
      console.error('Unable to paste from the system clipboard:', error);
    }
  };

  const json = editorRef.current?.getModel?.()?.getLanguageId?.() === 'json';
  const reflowJson = (mode) => (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClose();
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
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!model) return null;
    const selection = editor.getSelection();
    const hasSelection = Boolean(selection && !selection.isEmpty());
    const content = hasSelection ? model.getValueInRange(selection) : model.getValue();
    const startLine = hasSelection ? selection.startLineNumber : 1;
    const { tabs, activeTabId } = useEditorStore.getState();
    const tab = tabs.find((entry) => entry.id === activeTabId) || null;
    return {
      mode: 'code',
      content,
      language: model.getLanguageId() || 'plaintext',
      fileName: tab?.name || '',
      documentPath: tab?.path || '',
      startLine,
      isSelection: hasSelection,
    };
  };

  const captureSnapshot = (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClose();
    const payload = buildSnapshotPayload();
    if (payload) openSnapshotPayload(payload);
  };

  const captureQuickSnapshot = (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClose();
    const payload = buildSnapshotPayload();
    if (payload) void runQuickSnapshot(payload);
  };

  // 菜单项顺序与常见编辑器右键菜单保持一致，分隔项仅用于视觉分组。
  const editing = (key, action = trigger(monacoEditingCommands[key])) => ({
    key, label: t(`editor.menu.${key}`), ...editingShortcutOf(key), action,
  });
  const items = [
    editing('undo'),
    editing('redo'),
    { key: 's1', type: 'separator' },
    editing('cut'),
    editing('copy'),
    editing('paste', paste),
    { key: 's2', type: 'separator' },
    editing('selectAll'),
    { key: 'snapshot', label: t('editor.menu.snapshot'), shortcut: shortcutOf('captureSnapshot'), action: captureSnapshot },
    { key: 'quickSnapshot', label: t('editor.menu.quickSnapshot'), shortcut: shortcutOf('quickSnapshot'), action: captureQuickSnapshot },
    { key: 's3', type: 'separator' },
    { key: 'find', label: t('editor.menu.find'), shortcut: shortcutOf('findInEditor'), action: trigger('actions.find') },
    { key: 'replace', label: t('editor.menu.replace'), shortcut: shortcutOf('replaceInEditor'), action: trigger('editor.action.startFindReplaceAction') },
    { key: 's4', type: 'separator' },
    { key: 'changeAll', label: t('editor.menu.changeAllOccurrences'), shortcut: shortcutOf('changeAllOccurrences'), action: trigger('editor.action.changeAll') },
    { key: 'format', label: t('editor.menu.formatDocument'), shortcut: shortcutOf('formatDocument'), action: json ? reflowJson('format') : trigger('editor.action.formatDocument') },
    ...(json ? [
      { key: 'minify-json', label: t('editor.menu.minifyJson'), action: reflowJson('minify') },
      { key: 'expand-json', label: t('editor.menu.expandJson'), action: reflowJson('expand') },
    ] : []),
    { key: 's5', type: 'separator' },
    { key: 'cmd', label: t('editor.menu.commandPalette'), shortcut: shortcutOf('commandPalette'), action: trigger('editor.action.quickCommand') },
  ];

  return createPortal(
    <div ref={menuRef} className="monaco-context-menu" style={{ top: y, left: x }}>
      {items.map((item) => {
        if (item.type === 'separator') {
          return <div key={item.key} className="monaco-context-menu__sep" />;
        }
        return (
          <div key={item.key} className="monaco-context-menu__item" onMouseDown={item.action}>
            <span className="monaco-context-menu__label">{item.label}</span>
            <span className="monaco-context-menu__shortcut">{item.shortcut}</span>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
