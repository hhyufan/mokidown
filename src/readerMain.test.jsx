import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@utils/tauriInvoke';
import { listen } from '@tauri-apps/api/event';
import { ReaderWindow, ReaderHost } from './readerMain';
import { readFileContent, getDirectoryContents } from '@utils/tauriApi';
import useNotificationStore from '@store/useNotificationStore';

const { markdown, nativeWindow, expand, reveal } = vi.hoisted(() => ({
  markdown: vi.fn(),
  expand: vi.fn(),
  reveal: vi.fn(),
  nativeWindow: {
    label: 'reader-1', setTitle: vi.fn().mockResolvedValue(undefined),
    isMaximized: vi.fn().mockResolvedValue(false),
    onResized: vi.fn().mockResolvedValue(() => {}),
    setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@utils/tauriInvoke', () => ({ invoke: vi.fn() }));
vi.mock('@utils/tauriApi', () => ({
  readFileContent: vi.fn(), getDirectoryContents: vi.fn(),
  isSafUri: () => false, safDisplayName: (path) => path,
}));
vi.mock('@hooks/useTasks', () => ({ default: () => ({ active: null, tasks: [] }) }));
vi.mock('@/services/readerOpening', () => ({ expandReader: expand, revealReader: reveal }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => nativeWindow }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('@utils/startupHandover', () => ({ announceMainWindowReady: vi.fn() }));
vi.mock('@store/useConfigStore', () => ({
  default: () => ({ fontSize: 14, lineHeight: 24, backgroundEnabled: backgroundEnabled }),
}));
vi.mock('@store/useThemeStore', () => ({ default: () => 'light' }));
vi.mock('@hooks/useBackgroundImage', () => ({ useBackgroundImage: () => ({ url: backgroundEnabled ? 'blob:background' : null }) }));
vi.mock('@hooks/useBackgroundSurfaces', () => ({ useBackgroundSurfaces: ({ enabled, imageUrl }) => {
  React.useLayoutEffect(() => {
    if (!enabled) return undefined;
    document.documentElement.style.setProperty('--moki-background-image', imageUrl);
    return () => document.documentElement.style.removeProperty('--moki-background-image');
  }, [enabled, imageUrl]);
} }));
vi.mock('@components/editor/ReadOnlyMarkdown', () => ({ default: markdown }));
vi.mock('@components/editor/ReaderSourceEditor', () => ({ default: function SourceStub({ content, onReady, onPositionChange }) {
  React.useEffect(() => { finishSource = onReady; }, [onReady]);
  return React.createElement('div', { 'data-testid': 'source' },
    content, React.createElement('button', { onClick: () => onPositionChange({ lineNumber: 5, column: 2 }) }, 'Move cursor'));
} }));
vi.mock('@components/ui/FileTypeIcon', () => ({ default: () => null }));
vi.mock('@components/overlays/RuntimeLogDialog', () => ({ default: () => null }));
vi.mock('./i18n', () => ({}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));

globalThis.React = React;
let finishExpansion;
let finishContent;
let deferContent;
let finishSource;
let backgroundEnabled;
const documentInfo = {
  id: 'draft', path: '', name: 'notes.md', content: '# Ready', modified: true,
  opening: { x: 100, y: 80, preview: {
    token: 'drag-1', name: 'notes.md', width: 180, height: 36, background: '#fff', appearance: {},
  } },
};
beforeEach(() => {
  window.__TAURI_INTERNALS__ = {};
  vi.clearAllMocks();
  expand.mockResolvedValue(undefined);
  reveal.mockResolvedValue(undefined);
  deferContent = false;
  backgroundEnabled = false;
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  markdown.mockImplementation(function MarkdownStub({ content, onReady }) {
    React.useEffect(() => {
      finishContent = onReady;
      if (!deferContent) onReady?.();
    }, [onReady]);
    return React.createElement('article', { 'data-testid': 'markdown' }, content);
  });
  invoke.mockImplementation((command) => command === 'reader_ready'
    ? new Promise((resolve) => { finishExpansion = resolve; }) : Promise.resolve());
  readFileContent.mockImplementation((path) => invoke('read_file_content', { path }));
});
afterEach(() => { cleanup(); delete window.__TAURI_INTERNALS__; vi.unstubAllGlobals(); });

it.each(['binary', 'too-large', 'invalid-encoding', 'unreadable', 'not-file'])(
  'preserves the current document when breadcrumb selection is blocked as %s', async (kind) => {
    invoke.mockResolvedValue(undefined);
    readFileContent.mockResolvedValue({ success: false, blockedReason: kind, message: `blocked:${kind}` });
    getDirectoryContents.mockResolvedValue([{ name: 'blocked.bin', path: 'C:\\docs\\blocked.bin' }]);
    const notify = vi.spyOn(useNotificationStore.getState(), 'notify');
    render(<ReaderHost document={{ id: 'current', name: 'a.md', path: 'C:\\docs\\a.md', content: '# Current', modified: true }} />);
    fireEvent.click(screen.getByRole('button', { name: 'C:\\docs' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'blocked.bin' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('warning', 'notification.error', `blocked:${kind}`));
    expect(screen.getByTestId('markdown')).toHaveTextContent('# Current');
    expect(invoke).not.toHaveBeenCalledWith('reader_replace_document', expect.anything());
    expect(invoke).not.toHaveBeenCalledWith('open_reader_window', expect.anything());
    notify.mockRestore();
  });

it('switches breadcrumb content in place only after the new document has rendered', async () => {
  backgroundEnabled = true;
  invoke.mockResolvedValue(undefined);
  getDirectoryContents.mockResolvedValue([{ name: 'b.md', path: 'C:\\docs\\b.md' }]);
  readFileContent.mockResolvedValue({ success: true, content: '# Next', encoding: 'UTF-8', line_ending: 'LF' });
  render(<ReaderHost document={{ id: 'current', name: 'a.md', path: 'C:\\docs\\a.md', content: '# Current', modified: true }} />);
  await waitFor(() => expect(screen.getByTestId('markdown')).toHaveTextContent('# Current'));
  deferContent = true;
  fireEvent.click(screen.getByRole('button', { name: 'C:\\docs' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'b.md' }));
  await waitFor(() => expect(document.querySelector('.reader--staged')).not.toBeNull());
  expect(document.querySelector('.reader:not(.reader--staged) article')).toHaveTextContent('# Current');
  await act(async () => finishContent());
  expect(document.querySelector('.reader--staged')).toBeNull();
  expect(screen.getByTestId('markdown')).toHaveTextContent('# Next');
  expect(document.body).toHaveClass('moki-has-background');
  expect(document.documentElement.style.getPropertyValue('--moki-background-image')).toBe('blob:background');
  expect(document.querySelector('.reader').style.getPropertyValue('--moki-background-image')).toBe('url("blob:background")');
  expect(invoke).not.toHaveBeenCalledWith('open_reader_window', expect.anything());
});

it('does not mount Markdown or subscribe to resize events while the native expansion is running', async () => {
  const { container } = render(<ReaderWindow document={documentInfo} />);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('reader_ready'));
  expect(container.querySelector('.reader--opening')).not.toBeNull();
  expect(markdown).not.toHaveBeenCalled();
  expect(screen.queryByTestId('markdown')).toBeNull();
  expect(nativeWindow.onResized).not.toHaveBeenCalled();
  await act(async () => finishExpansion());
  expect(screen.getByTestId('markdown')).toHaveTextContent('# Ready');
  expect(container.querySelector('.reader--opening')).toBeNull();
  expect(nativeWindow.onResized).toHaveBeenCalledTimes(1);
});

it('uses the same drag snapshot geometry for the retained card and final top-left title', async () => {
  const preview = {
    ...documentInfo.opening.preview,
    markup: '<div style="width:180px;height:36px;padding:0 12px;display:flex;align-items:center;gap:8px;font-weight:600"><svg width="16" height="16"></svg><span>notes.md</span></div>',
  };
  const { container } = render(<ReaderWindow document={{
    ...documentInfo, opening: { ...documentInfo.opening, preview },
  }} />);
  const title = container.querySelector('.reader__title-snapshot > div');
  expect(container.querySelector('.reader__opening-card,.reader__opening-cover')).toBeNull();
  expect(title.style.height).toBe('36px');
  expect(title.style.padding).toBe('0px 12px');
  expect(title.style.gap).toBe('8px');
  expect(title.style.fontWeight).toBe('600');
  expect(title.textContent).toContain('notes.md');
  expect(title.querySelector('span').style.textOverflow).toBe('clip');
  expect(title.style.background).toBe('transparent');
  expect(title.style.transform).toBe('none');
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('reader_ready'));
  await act(async () => finishExpansion({ offsetX: 0, offsetY: 0 }));
});

it('renders Markdown while hidden and only expands the ready document, without a blank-panel stage', async () => {
  deferContent = true;
  let endAnimation;
  expand.mockImplementation(() => new Promise((resolve) => { endAnimation = resolve; }));
  const { container } = render(<ReaderWindow document={documentInfo} />);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('reader_ready'));
  await act(async () => finishExpansion({ offsetX: 0, offsetY: 0 }));
  expect(expand).not.toHaveBeenCalled();
  expect(screen.getByTestId('markdown')).toBeInTheDocument();
  expect(container.querySelector('.reader__opening-cover')).toBeNull();
  expect(container.querySelector('.reader--opening')).not.toBeNull();
  expect(reveal).not.toHaveBeenCalled();
  await act(async () => finishContent());
  expect(expand).toHaveBeenCalledTimes(1);
  await act(async () => endAnimation());
  expect(container.querySelector('.reader__opening-cover')).toBeNull();
  expect(invoke).toHaveBeenCalledWith('reader_present', { focus: true });
});

it('pre-renders a dragged document without showing it until the matching drop activates it', async () => {
  const { container } = render(<ReaderWindow document={{ ...documentInfo, prerender: true }} />);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('reader_ready'));
  await act(async () => finishExpansion({ offsetX: 0, offsetY: 0 }));
  expect(screen.getByTestId('markdown')).toHaveTextContent('# Ready');
  expect(expand).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalledWith('reader_present', expect.anything());
  const activate = listen.mock.calls.find(([name]) => name === 'reader:activate')[1];
  invoke.mockResolvedValue({ offsetX: 120, offsetY: 40 });
  await act(async () => activate());
  expect(expand).toHaveBeenCalledWith(expect.anything(), documentInfo.opening.preview,
    { offsetX: 120, offsetY: 40 }, expect.anything(), null);
  expect(container.querySelector('.reader--opening')).toBeNull();
});

it('activates a warm reader dropped before the initial ready response arrives', async () => {
  render(<ReaderWindow document={{ ...documentInfo, prerender: true }} />);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('reader_ready'));
  await act(async () => finishExpansion({ offsetX: 80, offsetY: 20, activated: true }));
  expect(screen.getByTestId('markdown')).toBeInTheDocument();
  expect(expand).toHaveBeenCalledWith(expect.anything(), documentInfo.opening.preview,
    { offsetX: 80, offsetY: 20, activated: true }, expect.anything(), null);
});

it('recovers visible content when preparing the native reveal fails', async () => {
  invoke.mockImplementation((command) => command === 'reader_ready'
    ? Promise.reject(new Error('prepare failed')) : Promise.resolve());
  const { container } = render(<ReaderWindow document={documentInfo} />);
  await waitFor(() => expect(screen.getByTestId('markdown')).toBeInTheDocument());
  await waitFor(() => expect(container.querySelector('.reader__opening-cover')).toBeNull());
  expect(invoke).toHaveBeenCalledWith('reader_present', { focus: true });
  expect(invoke).toHaveBeenCalledWith('close_drag_preview', { token: 'drag-1' });
});

it('shares the main window pin icon and uses a matching line-style return arrow', async () => {
  const { container } = render(<ReaderWindow document={documentInfo} />);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('reader_ready'));
  await act(async () => finishExpansion());
  const pin = screen.getByRole('button', { name: 'topbar.pin' });
  expect(pin).toHaveAttribute('aria-pressed', 'false');
  expect(pin.querySelector('.window-pin-icon--unpinned')).not.toBeNull();
  fireEvent.click(pin);
  await waitFor(() => expect(pin).toHaveAttribute('aria-pressed', 'true'));
  expect(pin.querySelector('.window-pin-icon--unpinned')).toBeNull();
  expect(nativeWindow.setAlwaysOnTop).toHaveBeenCalledWith(true);
  const arrow = container.querySelector('.reader__home svg');
  expect(arrow).toHaveAttribute('stroke-width', '2');
  expect(arrow).toHaveAttribute('stroke-linecap', 'round');
  expect(arrow.querySelector('rect')).toBeNull();
});

it('waits for the standalone source editor before expanding and tracks its cursor in the footer', async () => {
  render(<ReaderWindow document={{ ...documentInfo, name: 'config.json', content: '{}', encoding: 'UTF-16LE', lineEnding: 'CRLF' }} />);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('reader_ready'));
  await act(async () => finishExpansion({ offsetX: 0, offsetY: 0 }));
  await screen.findByTestId('source');
  expect(markdown).not.toHaveBeenCalled();
  expect(expand).not.toHaveBeenCalled();
  await act(async () => finishSource());
  expect(expand).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Move cursor' }));
  expect(screen.getByText('footer.line 5, footer.column 2')).toBeInTheDocument();
  expect(screen.getByText('UTF-16LE')).toBeInTheDocument();
  expect(screen.getByText('CRLF')).toBeInTheDocument();
});

it('delegates breadcrumb selection to the current reader navigation callback', async () => {
  const file = { name: 'a.json', path: 'C:\\docs\\a.json', is_dir: false };
  getDirectoryContents.mockResolvedValue([file]);
  invoke.mockResolvedValue(undefined);
  const navigate = vi.fn().mockResolvedValue(undefined);
  render(<ReaderWindow document={{ ...documentInfo, path: 'C:\\docs\\a.md', opening: undefined }} onNavigate={navigate} />);
  fireEvent.click(screen.getByRole('button', { name: 'C:\\docs' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'a.json' }));
  expect(navigate).toHaveBeenCalledWith(file);
  expect(invoke).not.toHaveBeenCalledWith('open_reader_window', expect.anything());
});

it('keeps the encoding and line ending returned by a disk read', async () => {
  invoke.mockImplementation((command) => command === 'read_file_content'
    ? Promise.resolve({ success: true, content: 'a\r\nb', encoding: 'UTF-16BE', line_ending: 'CRLF' })
    : Promise.resolve());
  render(<ReaderWindow document={{ id: 'file', path: 'C:\\docs\\a.md', name: 'a.md' }} />);
  await screen.findByText('UTF-16BE');
  expect(screen.getByText('CRLF')).toBeInTheDocument();
  expect(screen.getByText('4 footer.chars')).toBeInTheDocument();
});

it('keeps an ordinary reader hidden through disk loading and Markdown rendering', async () => {
  deferContent = true;
  let finishRead;
  invoke.mockImplementation((command) => command === 'read_file_content'
    ? new Promise((resolve) => { finishRead = resolve; }) : Promise.resolve());
  const { container } = render(<ReaderWindow document={{ id: 'file', path: 'C:\\docs\\a.md', name: 'a.md' }} />);
  expect(container.querySelector('.reader--pending')).not.toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByText('reader.loading')).toBeNull();
  expect(invoke).not.toHaveBeenCalledWith('reader_present', expect.anything());
  await act(async () => finishRead({ success: true, content: '# Complete' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('reader_ready'));
  expect(container.querySelector('.reader--pending')).not.toBeNull();
  expect(invoke).not.toHaveBeenCalledWith('reader_present', expect.anything());
  await act(async () => finishContent());
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('reader_present', { focus: true }));
  expect(container.querySelector('.reader--pending')).toBeNull();
  expect(screen.getByTestId('markdown')).toHaveTextContent('# Complete');
});

it('prepares the drag viewport while disk reading and font loading are still pending', async () => {
  deferContent = true;
  let finishRead;
  const fonts = Object.getOwnPropertyDescriptor(document, 'fonts');
  Object.defineProperty(document, 'fonts', {
    configurable: true, value: { ready: new Promise(() => {}) },
  });
  invoke.mockImplementation((command) => {
    if (command === 'read_file_content') return new Promise((resolve) => { finishRead = resolve; });
    if (command === 'reader_ready') return Promise.resolve({ offsetX: 0, offsetY: 0, activated: true });
    return Promise.resolve();
  });
  try {
    const { container } = render(<ReaderWindow document={{
      ...documentInfo, path: 'C:\\docs\\a.md', content: undefined, modified: false,
    }} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('reader_ready'));
    expect(screen.queryByTestId('markdown')).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith('reader_present', expect.anything());
    await act(async () => finishRead({ success: true, content: '# Parallel' }));
    expect(screen.getByTestId('markdown')).toHaveTextContent('# Parallel');
    expect(container.querySelector('.reader--pending')).not.toBeNull();
    expect(expand).not.toHaveBeenCalled();
    await act(async () => finishContent());
    expect(expand).toHaveBeenCalledTimes(1);
  } finally {
    if (fonts) Object.defineProperty(document, 'fonts', fonts);
    else delete document.fonts;
  }
});

it('presents a disk-read error without leaving the prepared window permanently hidden', async () => {
  invoke.mockImplementation((command) => command === 'read_file_content'
    ? Promise.resolve({ success: false, message: 'File unavailable' }) : Promise.resolve());
  render(<ReaderWindow document={{ id: 'missing', path: 'C:\\missing.md', name: 'missing.md' }} />);
  await screen.findByRole('alert');
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('reader_present', { focus: true }));
});

it('does not present an ordinary source reader until Monaco has rendered', async () => {
  invoke.mockResolvedValue(undefined);
  const { container } = render(<ReaderWindow document={{ id: 'source', name: 'a.json', path: '', content: '{}' }} />);
  await screen.findByTestId('source');
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('reader_ready'));
  expect(container.querySelector('.reader--pending')).not.toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
  expect(invoke).not.toHaveBeenCalledWith('reader_present', expect.anything());
  await act(async () => finishSource());
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('reader_present', { focus: true }));
  expect(container.querySelector('.reader--pending')).toBeNull();
});
