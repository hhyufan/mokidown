export function applyMarkdownToolbarAction(editor, action) {
  if (!editor || editor.handleToolbarAction?.(action)) return;
  if (action.type === 'insert') editor.insertText(action.text);
  else if (action.type === 'wrap') editor.wrapSelection(action.before, action.after);
}
