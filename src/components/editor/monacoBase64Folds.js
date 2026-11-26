import i18n from '@/i18n';
import { markdownBase64Ranges } from './markdownSections';

const toggleClass = 'moki-base64-toggle';
const toggleIdPrefix = 'moki-base64-toggle-at-';
const collapsedClass = 'moki-base64-collapsed';

export function bindMonacoBase64Folds(editor, monaco) {
  const decorations = editor.createDecorationsCollection();
  const option = monaco.editor.EditorOption.stopRenderingLineAfter;
  const defaultRenderLimit = editor.getOption(option);
  const expanded = new Set();
  const container = editor.getContainerDomNode();
  const key = ({ line, start }) => `${line}:${start}`;
  let model;
  let ranges = [];
  let renderLimit = defaultRenderLimit;
  let pending;
  let animationTimer;
  let animating;
  let pointer;
  let snapping = false;

  const snapSelections = (previous = []) => {
    if (snapping) return;
    const selections = editor.getSelections();
    if (!selections?.length) return;
    const snap = (line, column, oldColumn) => {
      const range = ranges.find((item) =>
        item.line === line && item.start < column && column < item.end && !expanded.has(key(item)),
      );
      if (!range) return column;
      if (oldColumn <= range.start) return range.end;
      if (oldColumn >= range.end) return range.start;
      return column - range.start < range.end - column ? range.start : range.end;
    };
    const next = selections.map((selection, index) => {
      const { selectionStartLineNumber, selectionStartColumn, positionLineNumber, positionColumn } = selection;
      const old = previous[index];
      const position = snap(positionLineNumber, positionColumn,
        old?.positionLineNumber === positionLineNumber ? old.positionColumn : undefined);
      const anchor = selection.isEmpty() ? position : snap(selectionStartLineNumber, selectionStartColumn,
        old?.selectionStartLineNumber === selectionStartLineNumber ? old.selectionStartColumn : undefined);
      return new monaco.Selection(selectionStartLineNumber, anchor, positionLineNumber, position);
    });
    if (next.every((selection, index) => selection.equalsSelection(selections[index]))) return;
    snapping = true;
    editor.setSelections(next);
    snapping = false;
  };

  const render = () => {
    let limit = defaultRenderLimit;
    const next = ranges.flatMap((range) => {
      const id = key(range);
      const open = expanded.has(id);
      if (!open && limit >= 0) limit = Math.max(limit, model.getLineLength(range.line) + 128);
      const classes = [toggleClass, `${toggleIdPrefix}${id}`, !open && collapsedClass, id === animating && 'moki-base64-rotating']
        .filter(Boolean).join(' ');
      const fold = {
        range: new monaco.Range(range.line, range.start, range.line, range.end),
        options: {
          description: 'markdown-base64-fold',
          inlineClassName: open ? undefined : 'moki-base64-payload',
          inlineClassNameAffectsLetterSpacing: !open,
          before: {
            content: open ? '\u2003' : '\u2003… Base64 …',
            inlineClassName: classes,
          },
          hoverMessage: { value: i18n.t(open ? 'editor.base64.collapse' : 'editor.base64.expand') },
        },
      };
      if (!open) return [fold];
      const line = model.getLineContent(range.line);
      const suffix = line.slice(range.end - 1).match(/^>?\s*(?:["'][^"']*["']\s*)?\)/)?.[0] ?? '';
      const column = range.end + suffix.length;
      if (limit >= 0) limit = Math.max(limit, column + 128);
      return [fold, {
        range: new monaco.Range(range.line, column, range.line, column),
        options: {
          description: 'markdown-base64-fold-from-end',
          showIfCollapsed: true,
          after: { content: '\u2003', inlineClassName: `${classes} moki-base64-end-toggle` },
          hoverMessage: { value: i18n.t('editor.base64.collapse') },
        },
      }];
    });
    decorations.set(next);
    // Keep the closing delimiter in the real model line so the cursor and
    // selection can move through it after the payload is hidden.
    if (renderLimit !== limit) {
      renderLimit = limit;
      editor.updateOptions({ stopRenderingLineAfter: limit });
    }
  };

  const refresh = () => {
    ranges = model?.getLanguageId() === 'markdown' ? markdownBase64Ranges(model.getValue()) : [];
    render();
  };
  const attach = () => {
    clearTimeout(pending);
    clearTimeout(animationTimer);
    animating = undefined;
    pointer = undefined;
    model = editor.getModel();
    expanded.clear();
    // Monaco wraps before rendering inline decorations. Give collapsed lines
    // an unwrapped projection so the hidden bytes contribute no visual rows.
    const lines = editor._getViewModel()?._lines;
    if (lines) {
      const create = lines.createLineBreaksComputer.bind(lines);
      lines.createLineBreaksComputer = () => {
        const wrapped = create();
        const unwrapped = lines._monospaceLineBreaksComputerFactory.createLineBreaksComputer(
          lines.fontInfo, lines.tabSize, -1, lines.wrappingIndent, lines.wordBreak,
        );
        const modes = [];
        return {
          addRequest(text, injected, previous) {
            const collapsed = injected?.some(({ options }) =>
              options.inlineClassName?.includes(collapsedClass),
            );
            modes.push(collapsed);
            if (collapsed) unwrapped.addRequest(text, injected, null);
            else wrapped.addRequest(text, injected, previous);
          },
          finalize() {
            const normal = wrapped.finalize();
            const compact = unwrapped.finalize();
            let nextNormal = 0;
            let nextCompact = 0;
            return modes.map((collapsed) => collapsed ? compact[nextCompact++] : normal[nextNormal++]);
          },
        };
      };
    }
    refresh();
  };
  const hitToggle = (element) => [...(element?.closest?.(`.${toggleClass}`)?.classList ?? [])]
    .find((name) => name.startsWith(toggleIdPrefix))?.slice(toggleIdPrefix.length);
  const beginClick = (event) => {
    const id = hitToggle(event.target);
    pointer = id && event.button === 0 && !event.shiftKey
      ? { id, x: event.clientX, y: event.clientY }
      : undefined;
  };
  const toggle = (event) => {
    const click = pointer;
    pointer = undefined;
    const id = hitToggle(container.ownerDocument.elementFromPoint(event.clientX, event.clientY));
    if (!click || id !== click.id ||
      Math.hypot(event.clientX - click.x, event.clientY - click.y) > 4) return;
    event.preventDefault();
    event.stopPropagation();
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    animating = id;
    render();
    snapSelections();
    if (!expanded.has(id)) {
      const range = ranges.find((item) => key(item) === id);
      if (range) editor.revealPositionInCenterIfOutsideViewport({ lineNumber: range.line, column: range.end });
    }
    clearTimeout(animationTimer);
    animationTimer = setTimeout(() => {
      animating = undefined;
      render();
    }, 180);
  };
  container.addEventListener('pointerdown', beginClick, true);
  container.addEventListener('pointerup', toggle, true);
  const subscriptions = [
    editor.onDidChangeModel(attach),
    editor.onDidChangeModelLanguage(refresh),
    editor.onDidChangeCursorSelection(({ oldSelections }) => snapSelections(oldSelections ?? [])),
    editor.onDidChangeModelContent((event) => {
      clearTimeout(pending);
      if (model?.getLanguageId() !== 'markdown') return;
      const changedImage = event.isFlush || event.changes.some(({ text, range }) =>
        /data:image\//i.test(text) ||
        /data:image\//i.test(model.getLineContent(Math.min(range.startLineNumber, model.getLineCount()))),
      );
      if (changedImage) {
        refresh();
        return;
      }
      pending = setTimeout(refresh, 120);
    }),
  ];
  attach();
  return () => {
    clearTimeout(pending);
    clearTimeout(animationTimer);
    container.removeEventListener('pointerdown', beginClick, true);
    container.removeEventListener('pointerup', toggle, true);
    subscriptions.forEach((subscription) => subscription.dispose());
    decorations.clear();
  };
}
