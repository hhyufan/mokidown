import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { EditorView } from '@milkdown/kit/prose/view';
import { baseKeymap } from '@milkdown/kit/prose/commands';
import { markRule } from '@milkdown/kit/prose';
import { keymap } from '@milkdown/kit/prose/keymap';
import { history, undo, redo } from '@milkdown/kit/prose/history';
import { inputRules } from '@milkdown/kit/prose/inputrules';
import { isImeComposing } from '@utils/keyboard';

const schema = new Schema({
  nodes: { doc: { content: 'inline*' }, text: { group: 'inline' } },
  marks: { code: { code: true, parseDOM: [{ tag: 'code' }], toDOM: () => ['code', 0] } },
});

// Match Milkdown's inline-code command: only toggle a nonempty selection.
const toggleInlineCode = (state, dispatch) => {
  if (state.selection.empty) return false;
  const { from, to } = state.selection;
  const mark = schema.marks.code;
  dispatch?.(state.doc.rangeHasMark(from, to, mark)
    ? state.tr.removeMark(from, to, mark)
    : state.tr.addMark(from, to, mark.create()));
  return true;
};

function titleDocument(source) {
  const content = source.split(/(`[^`]+`)/g).filter(Boolean).map((part) => part.startsWith('`') && part.endsWith('`')
    ? schema.text(part.slice(1, -1), [schema.marks.code.create()]) : schema.text(part));
  return schema.node('doc', null, content);
}

function titleSource(doc) {
  let source = '';
  doc.forEach((node) => {
    const text = (node.text || '').replace(/[\r\n]+/g, ' ');
    source += node.marks.some((mark) => mark.type === schema.marks.code) ? `\x60${text}\x60` : text;
  });
  return source;
}

export default function TreeNodeEditor({ source, size, onSave, onCancel }) {
  const { t } = useTranslation();
  const host = useRef(null);
  const callbacks = useRef({ onSave, onCancel });
  callbacks.current = { onSave, onCancel };
  const label = t('tree.editNode');
  const hint = t('tree.inputHint');

  useEffect(() => {
    let finished = false;
    let pendingBlur = false;
    let suppressEnter = false;
    let compositionTimer;
    const inlineCode = markRule(/(?:`)([^`]+)(?:`)$/, schema.marks.code);
    const finish = (cancel = false) => {
      if (finished) return;
      finished = true;
      if (cancel) callbacks.current.onCancel();
      else callbacks.current.onSave(titleSource(view.state.doc));
    };
    const view = new EditorView(host.current, {
      state: EditorState.create({
        doc: titleDocument(source),
        plugins: [inputRules({ rules: [inlineCode] }), history(), keymap({
          'Mod-e': toggleInlineCode, 'Mod-z': undo, 'Mod-Shift-z': redo, 'Mod-y': redo,
        }), keymap(baseKeymap)],
      }),
      attributes: { class: 'moki-tree__title moki-tree__rich-input', role: 'textbox', 'aria-label': label, 'aria-multiline': 'false', 'data-placeholder': hint },
      handleKeyDown: (editor, event) => {
        event.stopPropagation();
        if (isImeComposing(event) || editor.composing) return false;
        if (event.key === 'Enter' && suppressEnter) return true;
        if (event.key === 'Enter') { finish(); return true; }
        if (event.key === 'Escape') { finish(true); return true; }
        return false;
      },
      handlePaste: (editor, event) => {
        const text = event.clipboardData?.getData('text/plain');
        if (text == null) return false;
        editor.dispatch(editor.state.tr.insertText(text.replace(/[\r\n]+/g, ' ')));
        return true;
      },
      handleDOMEvents: {
        keydown: (editor, event) => {
          // Safari suppresses its first post-composition keydown before custom
          // keymaps run. Escape must still cancel this node's editing session.
          if (event.key !== 'Escape' || editor.composing || isImeComposing(event)) return false;
          event.preventDefault(); event.stopPropagation(); finish(true); return true;
        },
        blur: (editor) => {
          if (editor.composing) pendingBlur = true;
          else finish();
          return false;
        },
        compositionend: () => {
          suppressEnter = true;
          compositionTimer = setTimeout(() => {
            suppressEnter = false;
            if (pendingBlur) finish();
          }, 0);
          return false;
        },
        pointerdown: (_, event) => { event.stopPropagation(); return false; },
        mousedown: (_, event) => { event.stopPropagation(); return false; },
      },
    });
    // Keep the rendered spans and place the caret at the end without selecting
    // the whole title or exposing Markdown delimiters and jump expressions.
    view.focus();
    const selection = TextSelection.atEnd(view.state.doc);
    view.dispatch(view.state.tr.setSelection(selection));
    return () => { finished = true; clearTimeout(compositionTimer); view.destroy(); };
  }, [source, label, hint]);

  return <span ref={host} className="moki-tree__edit-field"
    style={size ? { '--tree-edit-width': `${size.width}px`, '--tree-edit-height': `${size.height}px` } : undefined} />;
}
