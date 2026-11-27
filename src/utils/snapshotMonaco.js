import * as monaco from 'monaco-editor';
import { initMonacoShiki } from './monacoShiki';

const indentColors = [
  'rgb(255 255 64 / var(--snapshot-indent-opacity))',
  'rgb(127 255 127 / var(--snapshot-indent-opacity))',
  'rgb(255 127 255 / var(--snapshot-indent-opacity))',
  'rgb(79 236 236 / var(--snapshot-indent-opacity))',
];
let nextScope = 0;

export const snapshotMonacoReady = () => initMonacoShiki();

export function createSnapshotMonaco(
  host,
  {
    tokens,
    indentWidths,
    indentRainbowStyle,
    dark,
    showLineNumbers,
    showIndentMarkers,
    startLine,
    tabSize,
    fontSize,
    fontFamily,
    foreground,
    muted,
    ariaLabel,
  },
) {
  const lines = tokens.map((line) => line.map((token) => token.content).join(''));
  const model = monaco.editor.createModel(lines.join('\n'), 'plaintext');
  model.updateOptions({ tabSize });

  // Monaco's theme applies to every editor. Scope these token colors to this card.
  const scope = `snapshot-monaco-${++nextScope}`;
  const style = document.createElement('style');
  const prefix = `.${scope} .monaco-editor`;
  const rules = [
    `${prefix}, ${prefix} .monaco-editor-background, ${prefix} .margin { background: transparent !important; }`,
    `${prefix} { --vscode-editorWhitespace-foreground: ${dark ? '#9da8ba' : '#687488'}; }`,
    `${prefix} .line-numbers { color: ${muted}; }`,
    `${prefix} .mtk1 { color: ${foreground}; }`,
  ];
  host.classList.add(scope);
  host.style.setProperty('--snapshot-indent-opacity', dark ? '0.12' : '0.1');
  let editor;
  const dispose = () => {
    editor?.dispose();
    model.dispose();
    style.remove();
    host.classList.remove(scope);
    host.style.removeProperty('--snapshot-indent-opacity');
  };

  try {
    editor = monaco.editor.create(host, {
      model,
      ariaLabel,
      readOnly: true,
      domReadOnly: true,
      fontSize,
      fontFamily,
      lineHeight: Math.round(fontSize * 1.68),
      fontLigatures: false,
      lineNumbers: showLineNumbers ? (line) => String(startLine + line - 1) : 'off',
      lineNumbersMinChars: Math.max(2, String(startLine + lines.length - 1).length),
      lineDecorationsWidth: showLineNumbers ? 16 : 0,
      renderWhitespace: showIndentMarkers ? 'boundary' : 'none',
      experimentalWhitespaceRendering: 'off',
      renderControlCharacters: false,
      renderLineHighlight: 'none',
      guides: { indentation: false, bracketPairs: false },
      folding: false,
      glyphMargin: false,
      stickyScroll: { enabled: false },
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      scrollBeyondLastColumn: 0,
      wordWrap: 'on',
      wrappingStrategy: 'advanced',
      wrappingIndent: 'same',
      stopRenderingLineAfter: -1,
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      occurrencesHighlight: 'off',
      selectionHighlight: false,
      contextmenu: false,
      scrollbar: {
        vertical: 'hidden',
        horizontal: 'hidden',
        verticalScrollbarSize: 0,
        horizontalScrollbarSize: 0,
        useShadows: false,
        alwaysConsumeMouseWheel: false,
      },
    });

    const tokenClasses = new Map();
    const decorations = [];
    tokens.forEach((line, index) => {
      const lineNumber = index + 1;
      let column = 1;
      for (const token of line) {
        const startColumn = column;
        column += token.content.length;
        if (column === startColumn) continue;
        const color = /^#[0-9a-f]{3,8}$/i.test(token.color) ? token.color : foreground;
        const fontStyle = Math.max(0, token.fontStyle | 0);
        const key = `${color}-${fontStyle}`;
        let className = tokenClasses.get(key);
        if (!className) {
          className = `snapshot-token-${tokenClasses.size}`;
          tokenClasses.set(key, className);
          rules.push(`${prefix} .${className} {
            color: ${color};
            ${fontStyle & 1 ? 'font-style: italic;' : ''}
            ${fontStyle & 2 ? 'font-weight: 600;' : ''}
            ${fontStyle & 4 ? 'text-decoration: underline;' : ''}
          }`);
        }
        decorations.push({
          range: new monaco.Range(lineNumber, startColumn, lineNumber, column),
          options: {
            inlineClassName: className,
            inlineClassNameAffectsLetterSpacing: Boolean(fontStyle & 3),
          },
        });
      }
    });

    if (indentWidths.length) {
      const { spaceWidth } = editor.getOption(monaco.editor.EditorOption.fontInfo);
      const step = spaceWidth * tabSize;
      const stops = indentColors.flatMap((color, level) => {
        const left = level * step;
        const right = left + step;
        return indentRainbowStyle === 'line'
          ? [`${color} ${left}px ${left + 1}px`, `transparent ${left + 1}px ${right}px`]
          : [`${color} ${left}px ${right}px`];
      });
      rules.push(`${prefix} .snapshot-indent {
        background-image: repeating-linear-gradient(to right, ${stops.join(',')});
        background-repeat: no-repeat;
        background-size: var(--snapshot-indent-width) 100%;
      }`);
      for (const width of new Set(indentWidths)) {
        if (width)
          rules.push(
            `${prefix} .snapshot-indent-${width} { --snapshot-indent-width: ${width * spaceWidth}px; }`,
          );
      }
      indentWidths.forEach((width, index) => {
        if (!width) return;
        decorations.push({
          range: new monaco.Range(index + 1, 1, index + 1, 1),
          options: { isWholeLine: true, className: `snapshot-indent snapshot-indent-${width}` },
        });
      });
    }
    style.textContent = rules.join('\n');
    host.appendChild(style);
    editor.createDecorationsCollection(decorations);
    return { editor, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

// Paint Monaco's visible rows in batches. Each token starts at its DOM position,
// including tab stops, wrapped-line indentation, and whitespace marker widths.
export function paintSnapshotMonaco(
  ctx,
  host,
  editor,
  x,
  y,
  height,
  { indentWidths, indentRainbowStyle, indentColors, tabSize },
) {
  const width = host.clientWidth;
  const pageHeight = host.clientHeight;
  const layout = editor.getLayoutInfo();
  const { lineHeight, spaceWidth } = editor.getOption(monaco.editor.EditorOption.fontInfo);
  const step = spaceWidth * tabSize;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // Whole-line decorations extend over the wrapped rows of their model line.
  indentWidths.forEach((columns, index) => {
    if (!columns) return;
    const top = editor.getTopForLineNumber(index + 1);
    const bottom =
      index + 1 === indentWidths.length ? height : editor.getTopForLineNumber(index + 2);
    const indentWidth = Math.min(columns * spaceWidth, layout.contentWidth);
    for (let offset = 0, level = 0; offset < indentWidth; offset += step, level++) {
      ctx.fillStyle = indentColors[level % indentColors.length];
      const blockWidth = indentRainbowStyle === 'line' ? 1 : step;
      ctx.fillRect(
        x + layout.contentLeft + offset,
        y + top,
        Math.min(blockWidth, indentWidth - offset),
        bottom - top,
      );
    }
  });

  const hostRect = host.getBoundingClientRect();
  const range = document.createRange();
  const paintText = (element, rowTop, rightAligned = false) => {
    const content = element.textContent;
    if (!content.trim()) return;
    const style = getComputedStyle(element);
    range.selectNodeContents(element);
    const rect = rightAligned ? element.getBoundingClientRect() : range.getBoundingClientRect();
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    ctx.fillStyle = style.color;
    const metrics = ctx.measureText(content);
    const fontCenter = (metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2;
    const baseline =
      y +
      rowTop +
      lineHeight / 2 +
      (Number.isFinite(fontCenter) ? fontCenter : parseFloat(style.fontSize) / 3);
    const left = x + (rightAligned ? rect.right - metrics.width : rect.left) - hostRect.left;
    ctx.fillText(content, left, baseline);
    if (style.textDecorationLine.includes('underline')) {
      ctx.fillRect(left, baseline + 2, metrics.width, 1);
    }
  };

  for (let pageTop = 0; pageTop < height; pageTop += pageHeight) {
    editor.setScrollTop(pageTop, monaco.editor.ScrollType.Immediate);
    editor.render(true);
    const actualScrollTop = editor.getScrollTop();
    const rowTop = (element) =>
      Math.round(element.getBoundingClientRect().top - hostRect.top + actualScrollTop);
    const isOnPage = (top) => top >= pageTop && top < pageTop + pageHeight;
    for (const row of host.querySelectorAll('.view-lines .view-line')) {
      const top = rowTop(row);
      if (!isOnPage(top)) continue;
      for (const token of row.querySelectorAll(':scope > span > span')) paintText(token, top);
    }
    for (const gutter of host.querySelectorAll('.line-numbers')) {
      const top = rowTop(gutter);
      if (isOnPage(top)) paintText(gutter, top, true);
    }
  }
  ctx.restore();
}
