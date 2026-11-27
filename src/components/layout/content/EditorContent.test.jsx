import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import useEditorStore from '@store/useEditorStore';
import useConfigStore from '@store/useConfigStore';
import useHistoryStore from '@store/useHistoryStore';
import useComparisonTypography from '@hooks/useComparisonTypography';
import { openExternal } from '@utils/tauriApi';
import EditorContent from './EditorContent';

globalThis.React = React;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
  // @/i18n 初始化时要用它。缺了它，只要有依赖链把 @/i18n 拉进来
  // （测试 → useEditorStore → untitledFileName → @/i18n）就会整体报错。
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('@utils/tauriApi', () => ({ openExternal: vi.fn(async () => {}) }));
vi.mock('@hooks/useFileManager', () => ({ useFileManager: () => ({ triggerAutoSave: vi.fn() }) }));
vi.mock('@hooks/useResponsiveLayout', () => ({
  useResponsiveLayout: () => ({ isMobileLayout: false }),
}));
vi.mock('@components/editor/LazyMonacoEditor', () => ({
  default: React.forwardRef(({ className }, _ref) => (
    <div data-testid="source" className={className}>
      source
    </div>
  )),
}));
vi.mock('@components/editor/MarkdownPreview', () => ({
  default: React.forwardRef(({ className, onReady }, _ref) => {
    React.useLayoutEffect(() => {
      onReady?.();
    }, [onReady]);
    return (
      <div className={className}>
        <a href="https://example.com/doc">preview link</a>
        <a href="next.md">local link</a>
      </div>
    );
  }),
}));
vi.mock('@components/editor/MilkdownMarkdownEditor', () => ({
  default: React.forwardRef(({ className }, _ref) => (
    <div className={className}>
      <a href="https://example.com/doc">
        <span>editable link</span>
      </a>
    </div>
  )),
}));
vi.mock('@components/editor/FloatingToolbar', () => ({ default: () => null }));
vi.mock('@components/editor/FloatingRunButton', () => ({ default: () => null }));
vi.mock('@components/history/HistoryDiffView', () => ({
  default: function HistoryDiffViewMock() {
    const mode = useHistoryStore((state) => state.viewMode);
    const diff = useHistoryStore((state) => state.diff);
    const root = React.useRef(null);
    const { fontSize } = useComparisonTypography(root, diff, mode === 'preview');
    return (
      <div ref={root} data-comparison-zoom={mode}>
        <div style={{ fontSize }}>original pane</div>
        <div style={{ fontSize }}>modified pane</div>
      </div>
    );
  },
}));
vi.mock('@components/ui/Toast', () => ({ default: () => null }));
beforeEach(() => {
  useHistoryStore.getState().clearDiff();
  useEditorStore.setState({ tabs: [], tabRenderList: [], activeTabId: null, viewMode: 'edit' });
  useConfigStore.setState({
    fontSize: 14,
    lineHeight: 24,
    previewFontSize: 14,
    previewLineHeight: 24,
    previewZoomSync: true,
    openLinksInEditor: false,
  });
  vi.clearAllMocks();
});

it('zooms both diff panes without changing the main editor or preview typography', async () => {
  useConfigStore.setState({ fontSize: 22, previewFontSize: 24, previewZoomSync: false });
  render(<EditorContent />);
  open('test.md');
  act(() => useHistoryStore.getState().setDiff({ tabId: 'test.md', content: '# Before' }));
  const original = await screen.findByText('original pane');
  const modified = screen.getByText('modified pane');
  expect(original).toHaveStyle({ fontSize: '14px' });
  fireEvent.wheel(original, { ctrlKey: true, deltaY: -120 });
  expect(modified).toHaveStyle({ fontSize: '15px' });
  act(() => useHistoryStore.getState().toggleViewMode());
  expect(original).toHaveStyle({ fontSize: '14px' });
  fireEvent.wheel(modified, { ctrlKey: true, deltaY: -120 });
  expect(original).toHaveStyle({ fontSize: '15px' });
  expect(useConfigStore.getState()).toMatchObject({ fontSize: 22, previewFontSize: 24 });
});
afterEach(cleanup);
function open(name, mode = 'edit') {
  act(() =>
    useEditorStore.setState({
      activeTabId: name,
      tabs: [{ id: name, name }],
      tabRenderList: [{ id: name, name }],
      viewMode: mode,
    }),
  );
}
it('drifts the welcome ornaments while keeping the character static', () => {
  useConfigStore.setState({ mokiDisplay: 'welcome' });
  const { container } = render(<EditorContent />);
  // 飘散动画常驻，是否真正播放由系统 prefers-reduced-motion 决定（CSS 层处理）。
  expect(container.querySelector('.moki-ambient--animated')).toBeInTheDocument();
  // 人物保持静止：动画只在周边符号上。
  expect(container.querySelector('.moki-sprite')).toBeInTheDocument();
});
it('drops the character from the welcome page when the switch is off', () => {
  useConfigStore.setState({ mokiDisplay: 'hidden' });
  const { container } = render(<EditorContent />);
  expect(container.querySelector('.moki-sprite')).not.toBeInTheDocument();
  expect(container.querySelector('.moki-welcome--plain')).toBeInTheDocument();
});
it('binds Ctrl+wheel after an empty workspace opens its first source file', async () => {
  render(<EditorContent />);
  open('first.js');
  const source = await screen.findByTestId('source');
  fireEvent.wheel(source, { ctrlKey: true, deltaY: -120 });
  expect(useConfigStore.getState().fontSize).toBe(15);
  fireEvent.wheel(source, { deltaY: -120 });
  expect(useConfigStore.getState().fontSize).toBe(15);
});
it('updates the visible synced font in WYSIWYG and opens nested Ctrl+click links', async () => {
  render(<EditorContent />);
  open('test.md', 'preview');
  const link = await screen.findByText('editable link');
  fireEvent.wheel(link, { ctrlKey: true, deltaY: -120 });
  expect(useConfigStore.getState()).toMatchObject({ fontSize: 15, previewFontSize: 15 });
  fireEvent.click(link, { ctrlKey: true });
  expect(openExternal).toHaveBeenCalledWith('https://example.com/doc');
});
it('routes Markdown web links to a tab when link takeover is enabled', async () => {
  useConfigStore.setState({ openLinksInEditor: true });
  render(<EditorContent />);
  open('test.md', 'preview');
  fireEvent.click(await screen.findByText('editable link'));
  expect(useEditorStore.getState().tabs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ builtin: 'web', url: 'https://example.com/doc' }),
    ]),
  );
  expect(openExternal).not.toHaveBeenCalled();
});
it('keeps split preview zoom independent and only intercepts external modifier clicks', async () => {
  useConfigStore.setState({ previewZoomSync: false });
  render(<EditorContent />);
  open('test.md', 'split');
  const link = await screen.findByText('preview link');
  fireEvent.wheel(link, { ctrlKey: true, deltaY: -120 });
  expect(useConfigStore.getState()).toMatchObject({ fontSize: 14, previewFontSize: 15 });
  fireEvent.click(link, { ctrlKey: true });
  expect(openExternal).toHaveBeenCalledOnce();
  const local = screen.getByText('local link');
  local.addEventListener('click', (event) => event.preventDefault());
  fireEvent.click(local, { ctrlKey: true });
  expect(openExternal).toHaveBeenCalledOnce();
});
