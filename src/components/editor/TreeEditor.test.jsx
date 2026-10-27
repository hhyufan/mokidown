import * as ReactRuntime from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import useEditorStore from '@store/useEditorStore';
import { clearBuffer, getBuffer, setBuffer } from '@utils/editorBuffer';
import TreeEditor from './TreeEditor';

globalThis.React = ReactRuntime;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
  // @/i18n 初始化时要用它。缺了它，只要有依赖链把 @/i18n 拉进来
  // （测试 → useEditorStore → untitledFileName → @/i18n）就会整体报错。
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const tabId = 'tree-editor-test';
const originalRangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
const originalRangeBounds = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
function setup(source = 'Root\n  Child >js++\nOther\n', props = {}) {
  setBuffer(tabId, source);
  const tab = { id: tabId, name: 'test.mgtree', content: source, modified: false };
  useEditorStore.setState({ activeTabId: tabId, tabs: [tab], tabRenderList: [tab] });
  return render(<TreeEditor {...props} />);
}

beforeEach(() => {
  localStorage.clear();
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() }));
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() });
});
afterEach(() => {
  cleanup(); clearBuffer(tabId);
  if (originalRangeRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRangeRects);
  else delete Range.prototype.getClientRects;
  if (originalRangeBounds) Object.defineProperty(Range.prototype, 'getBoundingClientRect', originalRangeBounds);
  else delete Range.prototype.getBoundingClientRect;
});

async function replaceTitle(element, html) {
  await act(async () => {
    element.innerHTML = html;
    fireEvent.input(element);
  });
}

describe('visual tree editing', () => {
  it('edits rendered inline code while preserving the independent jump expression', async () => {
    const onAutoSave = vi.fn();
    setup(undefined, { onAutoSave });
    fireEvent.click(screen.getByRole('button', { name: 'tree.expandAll' }));
    fireEvent.click(screen.getByRole('button', { name: 'Child' }));
    expect(screen.getByRole('textbox', { name: 'tree.editNode' })).toHaveTextContent('Child');
    expect(screen.getByRole('textbox', { name: 'tree.editNode' })).not.toHaveTextContent('>js');
    await replaceTitle(screen.getByRole('textbox', { name: 'tree.editNode' }), 'Edited <code>code</code>');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'tree.editNode' }), { key: 'Enter' });
    expect(getBuffer(tabId)).toContain('  Edited `code` >js++');
    expect(onAutoSave).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edited code' })).toBeInTheDocument());
    expect(useEditorStore.getState().tabs[0].modified).toBe(true);
  });

  it('cancels with Escape and does not commit IME confirmation Enter', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Root' }));
    const input = screen.getByRole('textbox', { name: 'tree.editNode' });
    await replaceTitle(input, '中文');
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(getBuffer(tabId)).toContain('Root');
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(getBuffer(tabId)).toContain('Root');
    expect(screen.queryByRole('textbox', { name: 'tree.editNode' })).not.toBeInTheDocument();
  });

  it('keeps the final IME candidate when the input blurs during composition', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Root' }));
    const input = screen.getByRole('textbox', { name: 'tree.editNode' });
    fireEvent.compositionStart(input);
    await replaceTitle(input, 'zhong');
    fireEvent.blur(input);
    expect(getBuffer(tabId)).toContain('Root');
    fireEvent.compositionEnd(input);
    await replaceTitle(input, '中文');
    await waitFor(() => expect(getBuffer(tabId)).toContain('中文\n'));
  });

  it('adds an editable first root and accepts later changes from the source pane', async () => {
    setup('');
    fireEvent.click(screen.getAllByRole('button', { name: 'tree.addRoot' })[0]);
    await screen.findByRole('textbox', { name: 'tree.editNode' });
    expect(getBuffer(tabId)).toBe('tree.newNode\n');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'tree.editNode' }), { key: 'Escape' });
    setBuffer(tabId, 'From source\n  Nested\n');
    await screen.findByRole('button', { name: 'From source' });
    fireEvent.click(screen.getByRole('button', { name: 'tree.expandAll' }));
    expect(screen.getByRole('button', { name: 'Nested' })).toBeInTheDocument();
  });

  it('gives only top-level rows a switcher outside every indent unit', () => {
    const { container } = setup(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'tree.expandAll' }));
    const rows = [...container.querySelectorAll('.ant-tree-treenode:not([aria-hidden])')];
    // tree-editor.scss drops the incoming vertical line for rows with no
    // `.ant-tree-indent-unit` descendant, i.e. root rows; the switcher itself
    // must stay a direct child of every row so that rule can reach it.
    const structure = rows.map((row) => [
      row.querySelectorAll('.ant-tree-indent-unit').length,
      row.querySelector(':scope > .ant-tree-switcher') !== null,
    ]);
    const labels = rows.map((row) => row.querySelector('.ant-tree-title')?.textContent);
    expect(structure).toEqual([[0, true], [1, true], [0, true]]);
    expect(labels.map((label, index) => label?.startsWith(['Root', 'Child', 'Other'][index]))).toEqual([true, true, true]);
  });

  it('routes split edits through Monaco and ignores stale row actions', async () => {
    const onSourceChange = vi.fn((next) => { setBuffer(tabId, next); return true; });
    setup(undefined, { onSourceChange });
    fireEvent.click(screen.getByRole('button', { name: 'Root' }));
    await replaceTitle(screen.getByRole('textbox', { name: 'tree.editNode' }), 'Changed');
    fireEvent.blur(screen.getByRole('textbox', { name: 'tree.editNode' }));
    expect(onSourceChange).toHaveBeenCalledWith('Changed\n  Child >js++\nOther\n');
    setBuffer(tabId, 'New source');
    fireEvent.click(screen.getAllByRole('button', { name: 'tree.deleteNode' })[0]);
    expect(getBuffer(tabId)).toBe('New source');
  });
});
