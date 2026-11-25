import { Compartment, countColumn, EditorState } from '@codemirror/state';
import { Decoration, ViewPlugin } from '@codemirror/view';
import useConfigStore from '@store/useConfigStore';

const tabSize = new Compartment();
const configuredTabSize = () => Math.max(1, Number(useConfigStore.getState().tabSize) || 4);

function indentedLines(view) {
  const { doc, tabSize } = view.state;
  const lines = [];
  let lastLine = 0;
  for (const { from, to } of view.visibleRanges) {
    const endLine = doc.lineAt(to).number;
    const startLine = Math.max(doc.lineAt(from).number, lastLine + 1);
    let inheritedWidth = null;
    for (let number = startLine; number <= endLine; number++) {
      const line = doc.line(number);
      const prefix = /^[ \t]+/.exec(line.text)?.[0];
      lastLine = number;
      if (!line.text && inheritedWidth == null) {
        let neighbor = number + 1;
        while (neighbor <= doc.lines && !doc.line(neighbor).text.trim()) neighbor++;
        if (neighbor > doc.lines) {
          neighbor = number - 1;
          while (neighbor > 0 && !doc.line(neighbor).text.trim()) neighbor--;
        }
        const neighborIndent = neighbor > 0 && neighbor <= doc.lines
          ? /^[ \t]*/.exec(doc.line(neighbor).text)[0] : '';
        inheritedWidth = countColumn(neighborIndent, tabSize);
      } else if (line.text.trim()) {
        inheritedWidth = null;
      }
      const columns = prefix ? countColumn(prefix, tabSize) : (!line.text ? inheritedWidth : 0);
      if (!columns) continue;
      lines.push(Decoration.line({
        class: 'moki-indented-code-line',
        attributes: { style: `--moki-code-indent: ${columns}ch; --moki-indent-width: ${tabSize}ch` },
      }).range(line.from));
      if (!prefix?.includes('\t')) continue;
      // Padding shifts native tab stops. Give leading tabs their original
      // widths so the first line and its continuations use the same columns.
      let column = 0;
      for (let index = 0; index < prefix.length; index++) {
        if (prefix[index] === '\t') {
          const width = tabSize - (column % tabSize);
          const from = line.from + index;
          lines.push(Decoration.mark({
            class: 'moki-code-indent-tab',
            attributes: { style: `tab-size: ${width}; inline-size: ${width}ch` },
          }).range(from, from + 1));
          column += width;
        } else {
          column++;
        }
      }
    }
  }
  return Decoration.set(lines, true);
}

export const milkdownCodeIndent = [
  tabSize.of(EditorState.tabSize.of(configuredTabSize())),
  ViewPlugin.fromClass(class {
    constructor(view) {
      this.decorations = indentedLines(view);
      const syncTabSize = () => {
        const size = configuredTabSize();
        if (view.state.tabSize !== size)
          view.dispatch({ effects: tabSize.reconfigure(EditorState.tabSize.of(size)) });
      };
      // The extension is shared by code blocks opened before and after a setting change.
      queueMicrotask(() => { if (this.unsubscribe) syncTabSize(); });
      this.unsubscribe = useConfigStore.subscribe((state, previous) => {
        if (state.tabSize !== previous.tabSize) syncTabSize();
      });
    }

    update(update) {
      if (update.docChanged || update.viewportChanged || update.startState.tabSize !== update.state.tabSize)
        this.decorations = indentedLines(update.view);
    }

    destroy() {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }, { decorations: (plugin) => plugin.decorations }),
];
