import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import useConfigStore from '@store/useConfigStore';
import useThemeStore from '@store/useThemeStore';
import useEditorStore from '@store/useEditorStore';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import {
  readBackgroundImage,
  saveBackgroundImage,
  deleteBackgroundImage,
  validateBackgroundImage,
} from '@utils/backgroundImage';
import i18n from '@/i18n';
import { normalizeMarkdownPairs } from '@utils/markdownPairs';

globalThis.React = React;
vi.mock('@components/ui/JsonCodeEditor', () => ({ default: () => null }));
const { default: SettingsModal } = await import('./SettingsModal');
const managedFiles = vi.hoisted(() => ({ load: vi.fn(), open: vi.fn() }));
vi.mock('@/services/settingsDocuments', () => ({ loadSettingsDocument: managedFiles.load }));
vi.mock('@hooks/useFileManager', () => ({
  useFileManager: () => ({ openFileFromPath: managedFiles.open }),
}));
vi.mock('@hooks/useResponsiveLayout', () => ({
  useResponsiveLayout: () => ({ isMobileLayout: false, isPortrait: false }),
}));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn(async () => 'test') }));
vi.mock('./LanguageServices', () => ({ default: () => null }));

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));
vi.mock('@utils/backgroundImage', async (original) => ({
  ...(await original()),
  readBackgroundImage: vi.fn(async () => new Blob(['image'])),
  saveBackgroundImage: vi.fn(async () => 'new-image'),
  deleteBackgroundImage: vi.fn(async () => {}),
  validateBackgroundImage: vi.fn(async () => {}),
}));
beforeEach(() => {
  i18n.changeLanguage('zh');
  localStorage.removeItem('mokidown-settings-view');
  useConfigStore.setState({ fontSize: 14, previewFontSize: 14, previewZoomSync: false });
  useConfigStore.setState({
    backgroundImage: '',
    backgroundImageName: '',
    backgroundEnabled: false,
    backgroundTransparency: { light: 80, dark: 80 },
  });
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() });
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const computedStyle = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => computedStyle(element));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  delete window.__TAURI_INTERNALS__;
});

it('chooses whether associated Markdown files open in the project editor or a single reader', async () => {
  useConfigStore.setState({ associatedOpenMode: 'editor' });
  await act(async () => render(<SettingsModal open onClose={vi.fn()} />));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '关联 Markdown 打开方式' }));
  fireEvent.click(await screen.findByText('单 MD 只读窗口'));
  expect(useConfigStore.getState().associatedOpenMode).toBe('reader');
});

it('searches across sections and switches back to the selected category', async () => {
  const previous = useEditorStore.getState();
  const doc = { id: 'settings-test-doc', name: 'note.md' };
  useEditorStore.setState({ tabs: [doc], tabRenderList: [doc], activeTabId: doc.id });
  try {
    const { container } = await act(async () => render(<SettingsModal />));
    expect(screen.queryByRole('textbox', { name: '搜索设置' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '搜索设置' }));
    const search = screen.getByRole('textbox', { name: '搜索设置' });
    expect(search).toHaveFocus();
    expect(screen.queryByRole('button', { name: '渲染器' })).toBeNull();
    fireEvent.change(search, { target: { value: '预览字号' } });
    expect(
      container.querySelector('.setting-row__label[data-settings-highlight]'),
    ).toHaveTextContent('预览字号');
    expect(search).toHaveFocus();
    expect(document.querySelector('.settings-page__results')).toBeNull();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: '搜索设置' })).toBeNull();
    expect(screen.getByRole('button', { name: '渲染器' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: '在侧边打开设置' })).toBeNull();
  } finally {
    useEditorStore.setState(previous);
  }
});

it('navigates matches in place using the previous and next buttons and keyboard', async () => {
  const { container } = await act(async () => render(<SettingsModal />));
  fireEvent.click(screen.getByRole('button', { name: '搜索设置' }));
  const search = screen.getByRole('textbox', { name: '搜索设置' });
  const highlight = () => container.querySelector('[data-settings-highlight]');
  fireEvent.change(search, { target: { value: '预览' } });
  const first = highlight()?.textContent;
  expect(first).toBeTruthy();
  expect(screen.getByRole('status')).toHaveTextContent(/^1\/\d+$/);
  const next = screen.getByRole('button', { name: '下一个匹配项' });
  const previous = screen.getByRole('button', { name: '上一个匹配项' });
  fireEvent.click(next);
  expect(highlight()?.textContent).not.toBe(first);
  expect(screen.getByRole('status')).toHaveTextContent(/^2\//);
  fireEvent.click(previous);
  expect(highlight()?.textContent).toBe(first);
  fireEvent.keyDown(search, { key: 'Enter', shiftKey: true });
  expect(screen.getByRole('status')).not.toHaveTextContent(/^1\//);
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(highlight()?.textContent).toBe(first);
  fireEvent.change(search, { target: { value: 'nothing-matches-this' } });
  expect(highlight()).toBeNull();
  expect(next).toBeDisabled();
});

it('switches the selected category with round icon buttons', async () => {
  const { container } = await act(async () => render(<SettingsModal />));
  const renderer = screen.getByRole('button', { name: '渲染器' });
  const appearance = screen.getByRole('button', { name: '外观' });
  fireEvent.click(renderer);
  expect(renderer).toHaveAttribute('aria-pressed', 'true');
  expect(appearance).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(appearance);
  expect(appearance).toHaveAttribute('aria-pressed', 'true');
  expect(renderer).toHaveAttribute('aria-pressed', 'false');
  expect(container.querySelector('.settings-nav')).toBeTruthy();
  expect(container.querySelector('.settings-capsule')).toBeNull();
});

it('opens the search panel to the right of the search button', async () => {
  const { container } = await act(async () => render(<SettingsModal />));
  const searchButton = screen.getByRole('button', { name: '搜索设置' });
  fireEvent.click(searchButton);
  expect(screen.getByRole('textbox', { name: '搜索设置' })).toHaveFocus();
  expect(searchButton).toBeInTheDocument();
  expect(container.querySelector('.settings-nav__search')).toBeTruthy();
  expect(container.querySelector('.settings-nav')).toHaveAttribute('data-searching', 'true');
});

it('adjusts both font sizes with compact number inputs', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () =>
    render(
      <React.StrictMode>
        <SettingsModal open onClose={vi.fn()} />
      </React.StrictMode>,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: '渲染器' }));
  const preview = screen.getByRole('spinbutton', { name: '预览字号' });
  expect(preview).toHaveValue('14');
  fireEvent.change(preview, { target: { value: '15' } });
  expect(useConfigStore.getState().previewFontSize).toBe(15);
  act(() => useConfigStore.setState({ previewZoomSync: true }));
  expect(screen.getByRole('spinbutton', { name: '预览字号' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '编辑器' }));
  const editor = screen.getByRole('spinbutton', { name: '编辑区字号' });
  fireEvent.change(editor, { target: { value: '13' } });
  expect(useConfigStore.getState().fontSize).toBe(13);
  fireEvent.change(editor, { target: { value: '24' } });
  expect(useConfigStore.getState().fontSize).toBe(24);
  expect(errors.mock.calls.flat().join(' ')).not.toMatch(
    /addonAfter|addonBefore|findDOMNode|Maximum update depth/,
  );
});

it('shows named Markdown syntax options and changes each smart pair independently', async () => {
  const { markdownSmartPairs, markdownSmartPairsEnabled } = useConfigStore.getState();
  const pairs = normalizeMarkdownPairs();
  useConfigStore.setState({ markdownSmartPairs: pairs, markdownSmartPairsEnabled: true });
  try {
    await act(async () => render(<SettingsModal open onClose={vi.fn()} />));
    fireEvent.click(screen.getByRole('button', { name: '渲染器' }));
    expect(screen.getByRole('list', { name: 'Markdown 智能配对' })).toBeInTheDocument();
    const backtick = screen.getByRole('checkbox', { name: '行内代码与代码块' });
    const parentheses = screen.getByRole('checkbox', { name: '圆括号' });
    const math = screen.getByRole('checkbox', { name: '公式' });
    const master = screen.getByRole('switch', { name: 'Markdown 智能配对' });
    expect(backtick).toBeChecked();
    // 「公式」这一项管三件事：两下把光标放进中间、行首第三下开块级、删一枚带走另一枚。
    expect(math).toBeChecked();
    expect(math).toHaveAccessibleDescription(/行首连打第三个即创建块级公式/);
    expect(math).toHaveAccessibleDescription(/成对移除公式两边的定界符/);
    expect(backtick).toHaveAccessibleDescription(/按 Enter 或确认语言/);
    fireEvent.click(backtick);
    expect(backtick).not.toBeChecked();
    expect(parentheses).toBeChecked();
    expect(useConfigStore.getState().markdownSmartPairs).toEqual(
      pairs.filter((pair) => pair !== '`'),
    );
    fireEvent.click(master);
    expect(master).not.toBeChecked();
    expect(parentheses).toBeDisabled();
    expect(parentheses).toBeChecked();
    fireEvent.click(master);
    expect(parentheses).toBeEnabled();
    expect(backtick).not.toBeChecked();
  } finally {
    act(() => useConfigStore.setState({ markdownSmartPairs, markdownSmartPairsEnabled }));
  }
});

it('enables task cascade by default and persists the editor switch', async () => {
  expect(useConfigStore.getInitialState().markdownTaskCascade).toBe(true);
  await act(async () => render(<SettingsModal open onClose={vi.fn()} />));
  fireEvent.click(screen.getByRole('button', { name: '渲染器' }));
  const toggle = screen.getByRole('switch', { name: '任务列表级联' });
  expect(toggle).toBeChecked();
  fireEvent.click(toggle);
  expect(toggle).not.toBeChecked();
  expect(useConfigStore.getState().markdownTaskCascade).toBe(false);
  fireEvent.click(toggle);
  expect(toggle).toBeChecked();
});

it('enables Markdown folding by default and updates the editor setting', async () => {
  expect(useConfigStore.getInitialState().markdownFolding).toBe(true);
  await act(async () => render(<SettingsModal open onClose={vi.fn()} />));
  fireEvent.click(screen.getByRole('button', { name: '渲染器' }));
  const toggle = screen.getByRole('switch', { name: 'Markdown 展开与折叠' });
  expect(toggle).toBeChecked();
  fireEvent.click(toggle);
  expect(toggle).not.toBeChecked();
  expect(useConfigStore.getState().markdownFolding).toBe(false);
  fireEvent.click(toggle);
  expect(toggle).toBeChecked();
});

it('imports a native image, persists its reference, previews theme-specific opacity, and removes the stored asset', async () => {
  window.__TAURI_INTERNALS__ = {};
  open.mockResolvedValue('C:\\pictures\\background.png');
  readFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
  await act(async () => render(<SettingsModal open onClose={vi.fn()} />));
  fireEvent.click(screen.getByRole('button', { name: '外观' }));
  fireEvent.click(screen.getByRole('button', { name: '选择图片' }));
  await waitFor(() => expect(useConfigStore.getState().backgroundImage).toBe('new-image'));
  expect(readFile).toHaveBeenCalledWith('C:\\pictures\\background.png');
  expect(saveBackgroundImage).toHaveBeenCalledWith(expect.any(Blob));
  expect(useConfigStore.getState().backgroundEnabled).toBe(true);
  expect(useConfigStore.getState().backgroundImageName).toBe('background.png');
  expect(await screen.findByRole('img', { name: '背景预览' })).toHaveStyle({ opacity: '0.2' });
  const light = screen.getByRole('slider', { name: '浅色主题背景透明度' });
  fireEvent.keyDown(light, { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 });
  expect(useConfigStore.getState().backgroundTransparency).toEqual({ light: 81, dark: 80 });
  act(() => useConfigStore.getState().setConfig('backgroundTransparency', { light: 100, dark: 0 }));
  // 主题切换入口已统一到 Moki 卡片区；这里只验证背景预览随主题变化的透明度，
  // 所以直接操作 store，避免把用例绑死在某个具体的切换控件上。
  act(() => useThemeStore.getState().setTheme('light'));
  expect(screen.getByRole('img', { name: '背景预览' })).toHaveStyle({ opacity: '0' });
  act(() => useThemeStore.getState().setTheme('dark'));
  expect(screen.getByRole('img', { name: '背景预览' })).toHaveStyle({ opacity: '1' });
  fireEvent.click(screen.getByRole('switch', { name: '启用背景图片' }));
  expect(useConfigStore.getState().backgroundImage).toBe('new-image');
  expect(screen.getByRole('img', { name: '背景预览' })).toHaveStyle({ opacity: '0' });
  fireEvent.click(screen.getByRole('button', { name: '移除' }));
  await waitFor(() => expect(deleteBackgroundImage).toHaveBeenCalledWith('new-image'));
  expect(useConfigStore.getState().backgroundImage).toBe('');
  expect(screen.queryByRole('img', { name: '背景预览' })).toBeNull();
  expect(readBackgroundImage).toHaveBeenCalledWith('new-image');
  act(() => useThemeStore.getState().setTheme('light'));
});

it('keeps the previous background if an image cannot be decoded', async () => {
  useConfigStore.setState({
    backgroundImage: 'previous',
    backgroundImageName: 'previous.png',
    backgroundEnabled: true,
  });
  window.__TAURI_INTERNALS__ = {};
  open.mockResolvedValue('C:\\bad.png');
  readFile.mockResolvedValue(new Uint8Array([0]));
  validateBackgroundImage.mockRejectedValueOnce(new Error('Invalid image'));
  await act(async () => render(<SettingsModal open onClose={vi.fn()} />));
  fireEvent.click(screen.getByRole('button', { name: '外观' }));
  fireEvent.click(screen.getByRole('button', { name: '选择图片' }));
  await waitFor(() => expect(validateBackgroundImage).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '选择图片' })).not.toHaveClass('ant-btn-loading'),
  );
  expect(useConfigStore.getState().backgroundImage).toBe('previous');
  expect(saveBackgroundImage).not.toHaveBeenCalled();
  expect(deleteBackgroundImage).not.toHaveBeenCalled();
});

it('uses one switch to control whether the character shows', async () => {
  useConfigStore.setState({ mokiDisplay: 'welcome' });
  await act(async () => render(<SettingsModal open onClose={vi.fn()} />));
  fireEvent.click(screen.getByRole('button', { name: '外观' }));
  const toggle = screen.getByRole('switch', { name: '人物显示' });
  expect(screen.queryByRole('slider', { name: '人物大小' })).not.toBeInTheDocument();
  expect(screen.queryByText('欢迎页与写作伙伴')).not.toBeInTheDocument();
  expect(toggle).toBeChecked();
  fireEvent.click(toggle);
  expect(useConfigStore.getState().mokiDisplay).toBe('hidden');
  // 「周边轻动效」开关已移除：动画改为遵从系统偏好，不再由应用内开关控制。
  expect(screen.queryByRole('switch', { name: '周边轻动效' })).not.toBeInTheDocument();
});

it('renders compact theme cards without the character and keeps the character toggle working', async () => {
  useConfigStore.setState({ mokiDisplay: 'welcome' });
  await act(async () => render(<SettingsModal open onClose={vi.fn()} />));
  fireEvent.click(screen.getByRole('button', { name: '外观' }));
  // 主题卡始终是紧凑形态，不再承载角色插画。
  expect(document.querySelectorAll('.moki-theme-card--compact')).toHaveLength(2);
  expect(document.querySelector('.moki-theme-card__art')).not.toBeInTheDocument();
  expect(document.querySelector('.moki-theme-cards--compact')).toBeInTheDocument();
  fireEvent.click(screen.getByText('夜读 · 深色'));
  expect(useThemeStore.getState().theme).toBe('dark');
  fireEvent.click(screen.getByText('晴笺 · 浅色'));
  expect(useThemeStore.getState().theme).toBe('light');
  // 人物显示开关仍只影响主界面形象，不影响主题卡。
  fireEvent.click(screen.getByRole('switch', { name: '人物显示' }));
  expect(useConfigStore.getState().mokiDisplay).toBe('hidden');
  expect(document.querySelectorAll('.moki-theme-card--compact')).toHaveLength(2);
});

it('switches tab behavior between spaces and tabs', async () => {
  await act(async () => render(<SettingsModal open onClose={vi.fn()} />));
  fireEvent.click(screen.getByRole('button', { name: '编辑器' }));
  fireEvent.click(screen.getByText('制表符'));
  expect(useConfigStore.getState().insertSpaces).toBe(false);
  fireEvent.click(screen.getByText('空格'));
  expect(useConfigStore.getState().insertSpaces).toBe(true);
});
