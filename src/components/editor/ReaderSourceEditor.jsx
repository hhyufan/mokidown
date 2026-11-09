import { useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import '@/monaco-worker';
import { getFileLanguage } from '@utils/fileLanguage';
import { initMonacoShiki, getMonacoThemeName } from '@utils/monacoShiki';
import './monaco-editor.scss';

/** One read-only model per reader, independent of tabs, plugins and editor buffers. */
export default function ReaderSourceEditor({ document: info, content, dark, config, onReady, onPositionChange }) {
  const container = useRef(null);
  const instance = useRef(null);
  const latest = useRef(null);
  const [error, setError] = useState('');
  latest.current = { info, content, dark, config, onReady, onPositionChange };

  const options = (value) => ({
    theme: getMonacoThemeName(value.dark),
    fontSize: value.config.fontSize || 14,
    lineHeight: value.config.lineHeight || 24,
    fontFamily: `'${value.config.fontFamily || 'JetBrains Mono'}', Consolas, monospace`,
    tabSize: value.config.tabSize || 2,
    wordWrap: value.config.wordWrap ? 'on' : 'off',
    lineNumbers: value.config.lineNumbers === false ? 'off' : 'on',
    minimap: value.config.minimap || { enabled: false },
    scrollbar: {
      verticalScrollbarSize: 6,
      horizontal: value.config.wordWrap ? 'hidden' : 'auto',
      horizontalScrollbarSize: value.config.wordWrap ? 0 : 6,
      useShadows: false,
    },
  });
  const optionBuilder = useRef(options);

  useEffect(() => {
    let cancelled = false;
    let editor;
    let model;
    let cursor;
    const mount = async () => {
      try {
        await Promise.all([initMonacoShiki(), document.fonts?.ready]);
        if (cancelled) return;
        const value = latest.current;
        const language = getFileLanguage(value.info.name);
        if (!monaco.languages.getLanguages().some((item) => item.id === language)) {
          monaco.languages.register({ id: language });
        }
        model = monaco.editor.createModel(value.content, language);
        editor = monaco.editor.create(container.current, {
          ...optionBuilder.current(value), model, automaticLayout: true,
          readOnly: true, domReadOnly: true, scrollBeyondLastLine: false,
          padding: { top: 12, bottom: 12 }, accessibilitySupport: 'auto',
          ariaLabel: value.info.name,
        });
        instance.current = editor;
        cursor = editor.onDidChangeCursorPosition(({ position }) => {
          latest.current.onPositionChange(position);
        });
        editor.layout();
        editor.render(true);
        latest.current.onReady();
      } catch (failure) {
        if (!cancelled) { setError(failure.message || String(failure)); latest.current.onReady(); }
      }
    };
    void mount();
    return () => {
      cancelled = true;
      instance.current = null;
      cursor?.dispose();
      editor?.dispose();
      model?.dispose();
    };
  }, []);

  useEffect(() => {
    const editor = instance.current;
    if (!editor) return;
    const model = editor.getModel();
    if (model.getValue() !== content) model.setValue(content);
    editor.updateOptions(optionBuilder.current(latest.current));
    monaco.editor.setTheme(getMonacoThemeName(dark));
  }, [content, dark, config]);

  return <div className="reader__source-editor">
    {error && <div className="reader__message" role="alert">{error}</div>}
    <div ref={container} className="monaco-editor-container" />
  </div>;
}
