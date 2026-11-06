import useConfigStore from '@store/useConfigStore';
import { isImeComposing } from '@utils/keyboard';
import { activeMarkdownPairs, inMarkdownCodeSpan, markdownAsteriskEdit, markdownBacktickEdit, markdownPairDeletion, markdownPairEnabled, matchingMarkdownBracket } from '@utils/markdownPairs';
import { completedFenceLanguage, readMarkdownFence } from '@utils/markdownCodeFence';

function insideFence(model, lineNumber) {
  let open = '';
  for (let line = 1; line < lineNumber; line++) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(model.getLineContent(line));
    if (!match) continue;
    const [, fence, rest] = match;
    if (!open) open = fence;
    else if (fence[0] === open[0] && fence.length >= open.length && !rest.trim()) open = '';
  }
  return Boolean(open);
}

export function bindMonacoMarkdownPairs(monaco, editor, showCodeLanguageMenu) {
  const isMarkdown = () => editor.getModel()?.getLanguageId() === 'markdown';
  let composing = false, disposed = false, popupQueued = false;
  let popupKey = '', fenceContext;
  const updateOptions = () => {
    popupKey = '';
    fenceContext = null;
    showCodeLanguageMenu(null);
    editor.updateOptions({
      autoClosingBrackets: isMarkdown() ? 'never' : 'languageDefined',
      autoClosingDelete: isMarkdown() ? 'never' : 'auto',
    });
  };
  updateOptions();

  const inCode = (model, lineNumber) => {
    if (fenceContext?.model !== model || fenceContext.lineNumber !== lineNumber) {
      fenceContext = { model, lineNumber, inside: insideFence(model, lineNumber) };
    }
    return fenceContext.inside;
  };
  const cursor = () => {
    if (!isMarkdown() || composing || editor.getOption(monaco.editor.EditorOption.readOnly)) return null;
    const selections = editor.getSelections();
    if (selections?.length !== 1 || !selections[0].isEmpty()) return null;
    const { lineNumber, column } = editor.getPosition();
    const model = editor.getModel();
    return { model, lineNumber, column, line: model.getLineContent(lineNumber) };
  };
  const pendingFence = (position) => {
    if (!position || position.column !== position.line.length + 1
      || !markdownPairEnabled(activeMarkdownPairs(useConfigStore.getState()), '`')) return null;
    const pending = readMarkdownFence(position.line);
    return pending && !inCode(position.model, position.lineNumber) ? pending : null;
  };
  const apply = (edits, lineNumber, column) => {
    editor.pushUndoStop();
    editor.executeEdits('markdown-smart-pairs', edits, [new monaco.Selection(lineNumber, column, lineNumber, column)]);
    editor.pushUndoStop();
  };
  const commitFence = (position, { indent, fence }, language) => {
    const { lineNumber, column, model } = position;
    const text = [`${indent}${fence}${language}`, indent, `${indent}${fence}`].join(model.getEOL());
    apply([{ range: new monaco.Range(lineNumber, 1, lineNumber, column), text }], lineNumber + 1, indent.length + 1);
  };
  const syncPopup = () => {
    popupQueued = false;
    if (disposed) return;
    const position = cursor();
    const pending = pendingFence(position);
    const nextKey = pending ? `${position.lineNumber}:${position.line}` : '';
    if (nextKey === popupKey) return;
    popupKey = nextKey;
    if (!pending || !editor.hasTextFocus()) { showCodeLanguageMenu(null); return; }
    const { model, lineNumber, column } = position;
    const current = () => {
      if (disposed) return false;
      const now = cursor();
      return now?.model === model && now.lineNumber === lineNumber && now.column === column && now.line === position.line && pendingFence(now);
    };
    showCodeLanguageMenu({
      query: pending.language,
      containsTarget: (target) => editor.getDomNode()?.contains(target),
      onScroll: editor.onDidScrollChange,
      getAnchor: () => {
        if (!current()) return null;
        const start = editor.getScrolledVisiblePosition({ lineNumber, column: pending.indent.length + 1 });
        const point = editor.getScrolledVisiblePosition({ lineNumber, column });
        const box = editor.getDomNode()?.getBoundingClientRect();
        if (!start || !point || !box || point.top + point.height <= 0 || point.top >= box.height) return null;
        return { x: box.left + start.left, y: box.top + point.top + point.height };
      },
      select: (language) => { if (current()) commitFence(position, pending, language); },
      undo: () => { if (current()) editor.trigger('markdown-smart-pairs', 'undo', null); },
      focus: () => { if (!disposed && editor.getModel() === model) editor.focus(); },
    });
  };
  const schedulePopup = () => {
    if (popupQueued) return;
    popupQueued = true;
    queueMicrotask(syncPopup);
  };
  const disposables = [
    editor.onDidChangeModel(updateOptions), editor.onDidChangeModelLanguage(updateOptions),
    editor.onDidChangeCursorPosition(schedulePopup),
    editor.onDidChangeModelContent((event) => {
      if (event.isFlush || event.changes.some(({ range }) => range.startLineNumber < fenceContext?.lineNumber)) fenceContext = null;
      schedulePopup();
    }),
    editor.onDidCompositionStart(() => { composing = true; }),
    editor.onDidCompositionEnd(() => { composing = false; schedulePopup(); }),
    editor.onKeyDown((event) => {
      const key = event.browserEvent;
      if (isImeComposing(key) || key.ctrlKey || key.metaKey || key.altKey) return;
      const position = cursor();
      if (!position) return;
      const preference = activeMarkdownPairs(useConfigStore.getState());
      const { model, lineNumber, column, line } = position;
      const offset = column - 1;
      const stop = () => { event.preventDefault(); event.stopPropagation(); };
      const range = (from, to) => new monaco.Range(lineNumber, from + 1, lineNumber, to + 1);
      const edit = (edits, cursorColumn) => {
        stop();
        apply(edits, lineNumber, cursorColumn);
      };
      const enter = key.key === 'Enter' && !key.shiftKey;
      if (enter || /^[\w+.#-]$/.test(key.key)) {
        const pending = pendingFence(position);
        if (pending) {
          const next = enter ? pending : readMarkdownFence(line + key.key);
          const language = enter ? pending.language : next && completedFenceLanguage(next.language);
          if (language != null) {
            stop();
            commitFence(position, pending, language);
            return;
          }
        }
      }
      if (key.key === '`' && markdownPairEnabled(preference, '`')) {
        const action = markdownBacktickEdit(line, offset);
        if (action && !inCode(model, lineNumber)) {
          if (action.kind === 'skip') { stop(); editor.setPosition({ lineNumber, column: column + 1 }); }
          else edit([{ range: range(offset, offset), text: '`' }], column + (action.kind === 'fence' ? 2 : 0));
          return;
        }
      }
      if (key.key === '*' && markdownPairEnabled(preference, '*')) {
        const asterisk = markdownAsteriskEdit(line, offset);
        if (asterisk && !inCode(model, lineNumber) && !inMarkdownCodeSpan(line, offset)) {
          if (asterisk.text) edit([{ range: range(offset, offset), text: asterisk.text }], column + asterisk.advance);
          else { stop(); editor.setPosition({ lineNumber, column: column + asterisk.advance }); }
          return;
        }
      }
      if (!key.shiftKey && (key.key === 'Backspace' || key.key === 'Delete')) {
        const target = line[key.key === 'Backspace' ? offset - 1 : offset] || '';
        if (!markdownPairEnabled(preference, target)) return;
        const markup = /[*_~`]/.test(target);
        const pair = markdownPairDeletion(line, offset, key.key);
        if (pair && (!markup || !inCode(model, lineNumber))) {
          const removedBefore = pair.reduce((total, part) => total + Math.max(0, Math.min(part.to, offset) - part.from), 0);
          edit(pair.map((part) => ({ range: range(part.from, part.to), text: '' })), column - removedBefore);
        }
        return;
      }
      if (!markdownPairEnabled(preference, key.key)) return;
      const bracket = matchingMarkdownBracket(line, offset, key.key);
      if (!bracket) return;
      if (bracket.text) edit([{ range: range(offset, offset), text: bracket.text }], column + bracket.advance);
      else { stop(); editor.setPosition({ lineNumber, column: column + bracket.advance }); }
    }),
  ];
  return () => {
    disposed = true;
    disposables.forEach((item) => item.dispose());
    showCodeLanguageMenu(null);
  };
}
