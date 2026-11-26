export async function pasteMonacoImages(editor, files) {
  const model = editor.getModel();
  const selection = editor.getSelection();
  if (!model || !selection || !files.length) return;
  const version = model.getVersionId();
  const markdown = model.getLanguageId() === 'markdown';
  const { markdownImageDestination, resolvePastedImage } = await import('./milkdownMarkdownPaste');
  const parts = [];
  for (const [index, file] of files.entries()) {
    const { src, name } = await resolvePastedImage(file, index);
    if (src) parts.push(markdown ? `![${name}](${markdownImageDestination(src)})` : src);
  }
  if (!parts.length || model.isDisposed() || editor.getModel() !== model ||
    model.getVersionId() !== version) return;
  editor.pushUndoStop();
  editor.executeEdits('paste-image', [{ range: selection, text: parts.join('\n') }]);
  editor.pushUndoStop();
}
import { hasNativeMenuClipboard, readMenuClipboard } from '@utils/menuClipboard';

export const monacoEditingCommands = {
  cut: 'editor.action.clipboardCutAction',
  copy: 'editor.action.clipboardCopyAction',
  selectAll: 'editor.action.selectAll',
  undo: 'undo',
  redo: 'redo',
};

export async function pasteMonacoClipboard(editor) {
  if (!hasNativeMenuClipboard() && !navigator.clipboard?.read) {
    editor.trigger('clipboard', 'editor.action.clipboardPasteAction', null);
    return;
  }
  const model = editor.getModel();
  const selection = editor.getSelection();
  if (!model) return;
  const version = model.getVersionId();
  const current = () => !model.isDisposed() && editor.getModel() === model &&
    model.getVersionId() === version && editor.getSelection()?.equalsSelection(selection);
  const insert = (text) => editor.trigger('clipboard', 'paste', {
    text, pasteOnNewLine: false, multicursorText: null,
  });
  const { text, files } = await readMenuClipboard();
  if (!current()) return;
  if (files.length) {
    await pasteMonacoImages(editor, files);
    return;
  }
  if (text) insert(text);
}

