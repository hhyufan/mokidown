import { EditorView } from '@codemirror/view';
import { expect, it } from 'vitest';
import { milkdownCodeIndent } from './milkdownCodeIndent';

it('continues rainbow indentation through blank code lines without inserting whitespace', () => {
  const parent = document.createElement('div');
  document.body.append(parent);
  const source = 'function demo() {\n  first();\n\n  second();\n\n}';
  const view = new EditorView({ parent, doc: source, extensions: milkdownCodeIndent });
  try {
    const lines = [...view.contentDOM.querySelectorAll('.cm-line')];
    expect(lines[2].style.getPropertyValue('--moki-code-indent')).toBe('2ch');
    expect(lines[4].classList.contains('moki-indented-code-line')).toBe(false);
    expect(view.state.doc.toString()).toBe(source);
  } finally {
    view.destroy();
    parent.remove();
  }
});
