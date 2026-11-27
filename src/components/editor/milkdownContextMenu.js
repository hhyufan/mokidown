import { commandsCtx, editorViewCtx, serializerCtx } from '@milkdown/kit/core';
import { AllSelection, TextSelection } from '@milkdown/kit/prose/state';
import { undoDepth, redoDepth } from '@milkdown/kit/prose/history';
import { toggleMark } from '@milkdown/kit/prose/commands';
import { undoCommand, redoCommand } from '@milkdown/kit/plugin/history';
import { toggleStrongCommand, emphasisSchema, wrapInHeadingCommand, wrapInBlockquoteCommand, createCodeBlockCommand } from '@milkdown/kit/preset/commonmark';
import { toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm';
import { insert } from '@milkdown/kit/utils';
import { EditorView as CodeMirrorView } from '@codemirror/view';
import { readMenuClipboard } from '@utils/menuClipboard';
import { copyMarkdownImage, selectedImageSource } from './milkdownImageClipboard';
import { getResolvedHotkeys } from '@hooks/useHotkeys';
import { formatKeybinding } from '@utils/keybinding';
import { editingShortcutOf } from '@utils/basicEditingShortcuts';
import { captureRenderedSelection, openSnapshotPayload, runQuickSnapshot } from '@utils/snapshotCapture';
import { renderedMarkdownHtml, selectedMarkdownHtml, selectedRange } from '@utils/markdownSelection';
import { persistentMilkdownDocument } from './milkdownEditingFlow';
import useEditorStore from '@store/useEditorStore';

function codeBlockLanguageForCm(view, cmElement) {
  try {
    const block = cmElement?.closest?.('.milkdown-code-block');
    if (block) {
      const pos = view.posAtDOM(block, 0);
      const $pos = view.state.doc.resolve(Math.max(0, Math.min(pos, view.state.doc.content.size)));
      for (let depth = $pos.depth; depth >= 0; depth--) {
        const node = $pos.node(depth);
        if (node.type.name === 'code_block') return node.attrs.language || 'plaintext';
      }
      const after = $pos.nodeAfter;
      if (after?.type.name === 'code_block') return after.attrs.language || 'plaintext';
      const label = block.querySelector('.language-button')?.textContent?.trim();
      if (label) return label;
    }
  } catch {
    /* Fall back to plaintext when CodeMirror is detached. */
  }
  return 'plaintext';
}

function serializeProseSelection(state, serialize) {
  const { selection, schema } = state;
  const fallback = state.doc.textBetween(selection.from, selection.to, '\n\n');
  try {
    const slice = selection.content();
    let doc = schema.topNodeType.createAndFill(null, slice.content);
    if (!doc && schema.nodes.paragraph) {
      const paragraph = schema.nodes.paragraph.createAndFill(null, slice.content);
      if (paragraph) doc = schema.topNodeType.createAndFill(null, paragraph);
    }
    if (!doc) return fallback;
    const serialized = serialize(doc);
    return String(serialized || '').trim() || fallback;
  } catch {
    return fallback;
  }
}

function renderedHtmlSelection(view, tab, target) {
  const selected = selectedMarkdownHtml(view.dom);
  if (selected) return captureRenderedSelection(selected.root, tab, selected.range);
  const block = target?.closest(renderedMarkdownHtml) ||
    view.dom.querySelector('.md-preview__html-block.ProseMirror-selectednode > .md-preview__html-block-preview');
  if (!block || block.hidden) return null;
  const blockRange = block.ownerDocument.createRange();
  blockRange.selectNodeContents(block);
  return captureRenderedSelection(block, tab, blockRange);
}

function snapshotFromEditorState({ state, codeState, language, serialize, tab, readRenderedSelection }) {
  const fileName = tab.name || '';
  const documentPath = tab.path || '';
  if (codeState) {
    const main = codeState.selection.main;
    const hasSelection = !main.empty;
    return {
      mode: 'code',
      content: hasSelection ? codeState.sliceDoc(main.from, main.to) : codeState.doc.toString(),
      language,
      fileName,
      documentPath,
      startLine: hasSelection ? codeState.doc.lineAt(main.from).number : 1,
      isSelection: hasSelection,
    };
  }
  const { selection } = state;
  const { $from, $to } = selection;
  const code = selection.node?.type.name === 'code_block' ? selection.node
    : $from.sameParent($to) && $from.parent.type.name === 'code_block' ? $from.parent
    : null;
  if (code) {
    const from = selection.node || selection.empty ? 0 : $from.parentOffset;
    const to = selection.node || selection.empty ? code.content.size : $to.parentOffset;
    return {
      mode: 'code',
      content: code.textContent.slice(from, to),
      language: code.attrs.language || 'plaintext',
      fileName,
      documentPath,
      startLine: code.textContent.slice(0, from).split('\n').length,
      isSelection: !selection.empty,
    };
  }
  const rendered = readRenderedSelection?.();
  if (rendered) return rendered;
  const hasSelection = !selection.empty;
  const content = hasSelection
    ? serializeProseSelection(state, serialize)
    : serialize(persistentMilkdownDocument(state));
  return {
    mode: 'markdown',
    content: String(content || ''),
    language: 'markdown',
    fileName,
    documentPath,
    startLine: 1,
    isSelection: hasSelection,
  };
}

export function extractMilkdownSnapshot(editor, cmElement, fileName, documentPath) {
  const { view, serialize } = editor.action((ctx) => ({
    view: ctx.get(editorViewCtx),
    serialize: ctx.get(serializerCtx),
  }));
  if (!view || view.isDestroyed) return null;
  const activeElement = view.dom.ownerDocument.activeElement;
  const activeCmEl = cmElement || (view.dom.contains(activeElement) && activeElement.closest('.cm-editor'));
  const cm = activeCmEl ? CodeMirrorView.findFromDOM(activeCmEl) : null;
  const editorState = useEditorStore.getState();
  const tab = {
    name: fileName || editorState.tabs.find((tab) => tab.id === editorState.activeTabId)?.name,
    path: documentPath,
  };
  const htmlPayload = cm ? null : renderedHtmlSelection(view, tab);
  return htmlPayload || snapshotFromEditorState({
    state: view.state,
    codeState: cm?.state,
    language: cm && codeBlockLanguageForCm(view, activeCmEl),
    serialize,
    tab,
    readRenderedSelection: () => captureRenderedSelection(view.dom, tab),
  });
}

export async function pasteMilkdownClipboard(view, cm, restore) {
  const { text, files } = await readMenuClipboard();
  if ((!text && !files.length) || !restore()) return;
  const clipboardData = new DataTransfer();
  if (text) clipboardData.setData('text/plain', text);
  for (const file of files) clipboardData.items.add(file);
  const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
  if (cm) cm.contentDOM.dispatchEvent(event);
  else if (files.length) view.someProp('handlePaste', (handler) => handler(view, event, null));
  else view.pasteText(text, event);
}

export function milkdownContextItems({
  editor, target, selectionRoot, domRange, x, y, t, canReplayHistory, replayHistory, documentPath,
}) {
  const { view, serialize } = editor.action((ctx) => ({
    view: ctx.get(editorViewCtx),
    serialize: ctx.get(serializerCtx),
  }));
  const cmElement = target.closest('.cm-editor');
  const cm = cmElement ? CodeMirrorView.findFromDOM(cmElement) : null;
  const editorState = useEditorStore.getState();
  const activeTab = editorState.tabs.find((tab) => tab.id === editorState.activeTabId);
  const rangeInCode = cm && domRange &&
    cm.contentDOM.contains(domRange.startContainer) && cm.contentDOM.contains(domRange.endContainer);
  const rangePayload = domRange && !rangeInCode && captureRenderedSelection(selectionRoot, activeTab, domRange);
  const nativeHtmlRange = domRange && selectedMarkdownHtml(selectionRoot, domRange);
  const htmlPayload = !cm && !domRange &&
    renderedHtmlSelection(view, { name: activeTab?.name, path: documentPath }, target);
  if (cm && cm.state.selection.main.empty) {
    const position = cm.posAtCoords({ x, y });
    if (position != null) cm.dispatch({ selection: { anchor: position } });
  } else if (!cm && !htmlPayload && !domRange && view.state.selection.empty && !selectedRange(view.dom)) {
    const position = view.posAtCoords({ left: x, top: y });
    if (position) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(position.pos))));
  }
  const selection = cm ? cm.state.selection : view.state.selection;
  // Screenshot commands can run from these snapshots without refocusing a live view.
  const renderedPayload = rangePayload || htmlPayload || (!cm && captureRenderedSelection(view.dom, activeTab));
  const snapshotState = {
    state: view.state,
    codeState: cm?.state,
    language: cm && codeBlockLanguageForCm(view, cmElement),
    serialize,
    tab: { name: activeTab?.name, path: documentPath || activeTab?.path },
  };
  const readSnapshot = () => renderedPayload || snapshotFromEditorState(snapshotState);
  const doc = cm ? cm.state.doc : view.state.doc;
  const selectedImage = cm || renderedPayload ? '' : selectedImageSource(view.state);
  const selected = renderedPayload ? renderedPayload.content
    : cm ? cm.state.sliceDoc(selection.main.from, selection.main.to)
    : selection.node?.type.name === 'html_block' ? selection.node.attrs.value
    : view.state.doc.textBetween(selection.from, selection.to, '\n\n');
  const current = () => cm ? cm.dom.isConnected && cm.state.doc === doc : !view.isDestroyed && view.state.doc === doc;
  const restore = () => {
    if (!current()) return false;
    if (cm) { cm.dispatch({ selection }); cm.focus(); }
    else { view.dispatch(view.state.tr.setSelection(selection)); view.focus(); }
    return true;
  };
  const edit = (text) => {
    if (!restore()) return;
    if (cm) cm.dispatch(cm.state.replaceSelection(text));
    else if (text === '') view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
    else editor.action(insert(text, true));
  };
  const run = (command, payload) => {
    if (!restore()) return;
    editor.action((ctx) => ctx.get(commandsCtx).call(command.key, payload));
    view.focus();
  };
  const history = (command, direction) => {
    if (!restore()) return;
    if (!replayHistory?.(direction)) editor.action((ctx) => ctx.get(commandsCtx).call(command.key));
    view.focus();
  };
  const item = (key, action, disabled = false) => ({
    key, label: t(`editor.menu.${key}`), ...editingShortcutOf(key), run: action, disabled,
  });
  const inCode = Boolean(cm || view.state.selection.$from.parent.type.spec.code);
  const hotkeys = getResolvedHotkeys();
  const binding = (id) => ({ keybinding: hotkeys[id], shortcut: formatKeybinding(hotkeys[id]) });
  return [
    item('undo', () => history(undoCommand, -1), undoDepth(view.state) === 0 && !canReplayHistory?.(-1)),
    item('redo', () => history(redoCommand, 1), redoDepth(view.state) === 0 && !canReplayHistory?.(1)),
    { key: 's1', separator: true },
    item('cut', async () => { await navigator.clipboard.writeText(selected); edit(''); }, !selected || Boolean(htmlPayload || nativeHtmlRange)),
    item('copy', () => selectedImage
      ? copyMarkdownImage(selectedImage, documentPath)
      : navigator.clipboard.writeText(selected), !selected && !selectedImage),
    item('paste', () => pasteMilkdownClipboard(view, cm, restore), Boolean(htmlPayload || nativeHtmlRange)),
    { key: 's2', separator: true },
    item('selectAll', () => {
      if (!restore()) return;
      if (cm) cm.dispatch({ selection: { anchor: 0, head: cm.state.doc.length } });
      else view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
    }),
    {
      key: 'snapshot',
      label: t('editor.menu.snapshot'),
      ...binding('captureSnapshot'),
      runOnPress: true,
      run: () => openSnapshotPayload(readSnapshot()),
    },
    {
      key: 'quickSnapshot',
      label: t('editor.menu.quickSnapshot'),
      ...binding('quickSnapshot'),
      runOnPress: true,
      run: () => runQuickSnapshot(readSnapshot()),
    },
    { key: 's3', separator: true },
    { key: 'bold', label: t('toolbar.bold'), ...binding('markdownBold'), disabled: inCode, run: () => run(toggleStrongCommand) },
    { key: 'italic', label: t('toolbar.italic'), ...binding('markdownItalic'), disabled: inCode, run: () => {
      if (!restore()) return;
      editor.action((ctx) => toggleMark(emphasisSchema.type(ctx), { marker: '*' })(view.state, view.dispatch.bind(view)));
    } },
    { key: 'strikethrough', label: t('toolbar.strikethrough'), ...binding('markdownStrikethrough'), disabled: inCode, run: () => run(toggleStrikethroughCommand) },
    { key: 's4', separator: true },
    { key: 'heading', label: t('editor.menu.heading2'), ...binding('markdownHeading2'), disabled: inCode, run: () => run(wrapInHeadingCommand, 2) },
    { key: 'blockquote', label: t('toolbar.blockquote'), ...binding('markdownQuote'), disabled: inCode, run: () => run(wrapInBlockquoteCommand) },
    { key: 'code', label: t('toolbar.code'), ...binding('markdownCodeBlock'), disabled: inCode, run: () => run(createCodeBlockCommand, '') },
  ];
}
