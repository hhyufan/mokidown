const DEFAULT_FONT_SIZE = 14;
const DEFAULT_LINE_HEIGHT = 24;

function clampFontSize(value) {
  return Math.max(10, Math.min(24, value));
}

function typographyUpdate(fontSize, lineHeight, nextFontSize) {
  return {
    fontSize: nextFontSize,
    lineHeight: Math.round((lineHeight / fontSize) * nextFontSize),
  };
}

export function buildReaderZoomUpdate(config, step) {
  const editorFontSize = config.fontSize || DEFAULT_FONT_SIZE;
  const editorLineHeight = config.lineHeight || DEFAULT_LINE_HEIGHT;
  const previewFontSize = config.previewFontSize || editorFontSize;
  const previewLineHeight = config.previewLineHeight || editorLineHeight;

  if (config.previewZoomSync) {
    const nextEditorSize = clampFontSize(editorFontSize + step);
    const nextPreviewSize = clampFontSize(previewFontSize + step);
    const editor = typographyUpdate(editorFontSize, editorLineHeight, nextEditorSize);
    const preview = typographyUpdate(previewFontSize, previewLineHeight, nextPreviewSize);
    return {
      fontSize: editor.fontSize,
      lineHeight: editor.lineHeight,
      previewFontSize: preview.fontSize,
      previewLineHeight: preview.lineHeight,
    };
  }

  const nextPreviewSize = clampFontSize(previewFontSize + step);
  return {
    previewFontSize: nextPreviewSize,
    previewLineHeight: Math.round((previewLineHeight / previewFontSize) * nextPreviewSize),
  };
}
