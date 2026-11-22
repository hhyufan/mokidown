/**
 * Monaco 彩虹缩进（indent-rainbow）。
 *
 * 缩进参考线只是竖线；这里要的是「每一层缩进占用的空白，按层级涂不同颜色的背景」。
 * Monaco 没有内置缩进背景，所以用 inline decoration 给每行前导空白按层分段着色。
 *
 * - 只处理可见范围，滚动/内容/主题变化时重绘（rAF 节流）；
 * - 颜色带透明度，深浅主题各一套；
 * - 编辑器没有 decorations API（测试环境）时返回空清理函数。
 */

/* 行装饰类按缩进层数取背景渐变；--moki-indent-width 由 JS 按 tabSize 写入。 */

export function installIndentRainbow(editor, monaco) {
  if (!editor?.onDidChangeModelContent || !editor?.getModel || !monaco?.Range) {
    return () => {};
  }

  const collection = editor.createDecorationsCollection?.([]) ?? null;
  let legacyIds = [];
  let frame = 0;

  const apply = (decorations) => {
    if (collection) {
      collection.set(decorations);
    } else {
      legacyIds = editor.deltaDecorations?.(legacyIds, decorations) ?? [];
    }
  };

  const paint = () => {
    frame = 0;
    const model = editor.getModel();
    if (!model) return;
    const indentSize = Math.max(
      1,
      editor.getOption?.(monaco.editor?.EditorOption?.indentSize) ||
        model.getOptions?.().tabSize ||
        4,
    );
    const tabSize = Math.max(1, model.getOptions?.().tabSize || indentSize);
    editor.getContainerDomNode?.()?.style.setProperty('--moki-indent-width', `${indentSize}ch`);
    const decorations = [];
    const lineCount = model.getLineCount();
    for (const range of editor.getVisibleRanges?.() ?? []) {
      const endLine = Math.min(range.endLineNumber + 1, lineCount);
      const lines = [];
      for (let line = range.startLineNumber; line <= endLine; line++) {
        const text = model.getLineContent(line);
        let width = 0;
        let cursor = 0;
        while (cursor < text.length && (text[cursor] === ' ' || text[cursor] === '\t')) {
          width += text[cursor] === '\t' ? tabSize - (width % tabSize) : 1;
          cursor++;
        }
        lines.push({ line, width, trimmed: Boolean(text.trim()) });
      }
      // 空行优先跟随「下一非空行」的缩进：空行之后的代码缩进更深时，色块也延伸过去。
      const nextWidths = new Array(lines.length).fill(null);
      let nextWidth = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trimmed) nextWidth = lines[i].width;
        nextWidths[i] = nextWidth;
      }
      let previousWidth = null;
      for (let i = 0; i < lines.length; i++) {
        const item = lines[i];
        if (item.trimmed) {
          previousWidth = item.width;
          if (!item.width) continue;
        }
        // 纯空格行也按自身空格数算层级；只有完全空行才跟随相邻非空行。
        const width =
          item.trimmed || item.width ? item.width : (nextWidths[i] ?? previousWidth ?? 0);
        if (!width) continue;
        decorations.push({
          range: new monaco.Range(item.line, 1, item.line, 1),
          options: {
            isWholeLine: true,
            className: `moki-indent-rainbow-line-${Math.min(1024, width)}`,
          },
        });
      }
    }
    apply(decorations);
  };

  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(paint);
  };

  const listeners = [
    editor.onDidChangeModelContent?.(schedule),
    editor.onDidScrollChange?.(schedule),
    editor.onDidChangeModel?.(schedule),
    editor.onDidChangeConfiguration?.(schedule),
    editor.onDidLayoutChange?.(schedule),
  ].filter(Boolean);

  const themeObserver =
    typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null;
  themeObserver?.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });

  schedule();
  const firstPaint = setTimeout(schedule, 80);

  return () => {
    clearTimeout(firstPaint);
    if (frame) cancelAnimationFrame(frame);
    for (const listener of listeners) listener.dispose?.();
    themeObserver?.disconnect();
    apply([]);
  };
}
