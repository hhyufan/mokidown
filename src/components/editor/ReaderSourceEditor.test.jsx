import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import ReaderSourceEditor from './ReaderSourceEditor';

const { model, editor, create, createModel, initialize } = vi.hoisted(() => {
  const model = { getValue: vi.fn(), setValue: vi.fn(), dispose: vi.fn() };
  const editor = {
    layout: vi.fn(), render: vi.fn(), dispose: vi.fn(), getModel: () => model,
    updateOptions: vi.fn(), onDidChangeCursorPosition: vi.fn(),
    getLayoutInfo: vi.fn(() => ({ height: 400 })),
    getScrollTop: vi.fn(() => 0), getScrollHeight: vi.fn(() => 1200),
    onDidScrollChange: vi.fn(() => ({ dispose: vi.fn() })),
    onDidLayoutChange: vi.fn(() => ({ dispose: vi.fn() })),
    setScrollTop: vi.fn(),
  };
  return { model, editor, create: vi.fn(() => editor), createModel: vi.fn(() => model),
    initialize: vi.fn().mockResolvedValue(undefined) };
});
vi.mock('monaco-editor', () => ({
  editor: { create, createModel, setTheme: vi.fn() },
  languages: { getLanguages: () => [{ id: 'json' }], register: vi.fn() },
}));
vi.mock('@/monaco-worker', () => ({}));
vi.mock('@utils/monacoShiki', () => ({
  initMonacoShiki: initialize, getMonacoThemeName: (dark) => dark ? 'one-dark-pro' : 'one-light',
}));
vi.mock('@utils/fileLanguage', () => ({ getFileLanguage: () => 'json' }));
globalThis.React = React;
const props = () => ({
  document: { name: 'config.json', path: 'C:\\config.json' }, content: '{}', dark: false,
  config: { fontSize: 14, lineHeight: 24, wordWrap: true, minimap: { enabled: false } },
  onReady: vi.fn(), onPositionChange: vi.fn(),
});
beforeEach(() => {
  vi.clearAllMocks();
  initialize.mockResolvedValue(undefined);
  model.getValue.mockReturnValue('{}');
  editor.onDidChangeCursorPosition.mockReturnValue({ dispose: vi.fn() });
});
afterEach(cleanup);

it('waits for highlighting before creating its single read-only model and signaling readiness', async () => {
  let complete;
  initialize.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
  const value = props();
  render(<ReaderSourceEditor {...value} />);
  expect(create).not.toHaveBeenCalled();
  expect(value.onReady).not.toHaveBeenCalled();
  complete();
  await waitFor(() => expect(value.onReady).toHaveBeenCalledTimes(1));
  expect(createModel).toHaveBeenCalledWith('{}', 'json');
  expect(create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    readOnly: true, domReadOnly: true, theme: 'one-light', minimap: { enabled: false },
    scrollbar: { verticalScrollbarSize: 6, horizontal: 'hidden', horizontalScrollbarSize: 0, useShadows: false },
  }));
  expect(editor.render).toHaveBeenCalledWith(true);
  const cursor = editor.onDidChangeCursorPosition.mock.calls[0][0];
  cursor({ position: { lineNumber: 3, column: 7 } });
  expect(value.onPositionChange).toHaveBeenCalledWith({ lineNumber: 3, column: 7 });
});

it('updates content and typography without creating another editor, and disposes its model', async () => {
  const value = props();
  const view = render(<ReaderSourceEditor {...value} />);
  await waitFor(() => expect(value.onReady).toHaveBeenCalled());
  view.rerender(<ReaderSourceEditor {...value} content={'{"a":1}'} config={{ ...value.config, fontSize: 18 }} />);
  expect(create).toHaveBeenCalledTimes(1);
  expect(model.setValue).toHaveBeenCalledWith('{"a":1}');
  expect(editor.updateOptions).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 18 }));
  view.unmount();
  expect(editor.dispose).toHaveBeenCalledTimes(1);
  expect(model.dispose).toHaveBeenCalledTimes(1);
});

it('restores the shared horizontal scrollbar when wrapping is disabled', async () => {
  const value = props();
  const view = render(<ReaderSourceEditor {...value} />);
  await waitFor(() => expect(value.onReady).toHaveBeenCalled());
  view.rerender(<ReaderSourceEditor {...value} config={{ ...value.config, wordWrap: false }} />);
  expect(editor.updateOptions).toHaveBeenCalledWith(expect.objectContaining({
    scrollbar: { verticalScrollbarSize: 6, horizontal: 'auto', horizontalScrollbarSize: 6, useShadows: false },
  }));
});

it('does not create an editor if the reader closes during preparation', async () => {
  let complete;
  initialize.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
  const value = props();
  const view = render(<ReaderSourceEditor {...value} />);
  view.unmount();
  complete();
  await Promise.resolve();
  expect(create).not.toHaveBeenCalled();
  expect(value.onReady).not.toHaveBeenCalled();
});
