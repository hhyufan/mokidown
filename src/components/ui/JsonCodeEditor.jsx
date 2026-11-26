import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import useConfigStore from '@store/useConfigStore';
import useThemeStore from '@store/useThemeStore';
import { getMonacoThemeName, initMonacoShiki } from '@utils/monacoShiki';
import { installIndentRainbow } from '@utils/monacoIndentRainbow';
import './json-code-editor.scss';

/**
 * 轻量 JSON 编辑器：只保留项目的语法高亮、缩进、彩虹缩进与编辑能力，
 * 不挂 LSP、Monaco 工具栏和小地图（这些属于完整文件编辑器）。
 *
 * @param {object} props 组件属性。
 * @param {string} props.value 当前文本。
 * @param {(value: string) => void} [props.onChange] 文本变化回调。
 * @param {string} [props.className] 额外样式类。
 * @param {number} [props.height] 编辑器高度（px）。
 * @param {number} [props.fontSize] 覆盖配置里的字号。
 * @param {number} [props.lineHeight] 覆盖配置里的行高。
 * @returns {JSX.Element} JSON 编辑器。
 */
export default function JsonCodeEditor({
  value,
  onChange,
  className = '',
  height = 260,
  fontSize: fontSizeProp,
  lineHeight: lineHeightProp,
}) {
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const configFontSize = useConfigStore((s) => s.fontSize);
  const configLineHeight = useConfigStore((s) => s.lineHeight);
  const fontSize = fontSizeProp ?? configFontSize;
  const lineHeight = lineHeightProp ?? configLineHeight;
  const fontFamily = useConfigStore((s) => s.fontFamily);
  const tabSize = useConfigStore((s) => s.tabSize);
  const insertSpaces = useConfigStore((s) => s.insertSpaces);
  const dark = useThemeStore((s) => s.theme === 'dark');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    void initMonacoShiki();
    monaco.languages.json?.jsonDefaults?.setDiagnosticsOptions?.({
      allowComments: true,
      trailingCommas: 'ignore',
      validate: true,
    });
    const editor = monaco.editor.create(container, {
      value: value ?? '',
      language: 'json',
      theme: getMonacoThemeName(dark),
      fontSize,
      lineHeight,
      fontFamily,
      tabSize,
      insertSpaces,
      automaticLayout: true,
      minimap: { enabled: false },
      lineNumbers: 'on',
      wordWrap: 'on',
      folding: true,
      scrollBeyondLastLine: false,
      renderLineHighlight: 'none',
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      contextmenu: false,
      padding: { top: 8, bottom: 8 },
      scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6, useShadows: false },
    });
    editorRef.current = editor;
    const stopIndentRainbow = installIndentRainbow(editor, monaco);
    const subscription = editor.onDidChangeModelContent(() => {
      onChangeRef.current?.(editor.getValue());
    });
    return () => {
      subscription.dispose();
      stopIndentRainbow?.();
      editor.dispose();
      editorRef.current = null;
    };
    // 首次创建即可；后续的字体、主题、缩进通过下面的 effect 更新。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editor.getValue() !== (value ?? '')) editor.setValue(value ?? '');
  }, [value]);

  useEffect(() => {
    editorRef.current?.updateOptions({
      fontSize,
      lineHeight,
      fontFamily,
      tabSize,
      insertSpaces,
    });
    editorRef.current?.getModel()?.updateOptions({ tabSize, insertSpaces });
  }, [fontSize, lineHeight, fontFamily, tabSize, insertSpaces]);

  useEffect(() => {
    monaco.editor.setTheme(getMonacoThemeName(dark));
  }, [dark]);

  return (
    <div
      ref={containerRef}
      className={`json-code-editor ${className}`}
      style={{ height }}
      role="textbox"
      aria-multiline="true"
    />
  );
}
