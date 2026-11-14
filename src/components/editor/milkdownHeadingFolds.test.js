import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState } from '@milkdown/kit/prose/state';
import { EditorView } from '@milkdown/kit/prose/view';
import { createMilkdownHeadingFoldsPlugin } from './milkdownHeadingFolds';
import { createMilkdownFoldBridge } from './milkdownFoldBridge';
import { getDocumentViewState, restoreDocumentViewStates, setDocumentViewState } from '@utils/documentViewState';
import { bindMonacoFoldControls } from './markdownSplitSync';

const config = vi.hoisted(() => ({ state: { markdownFolding: true }, listeners: new Set() }));
vi.mock('@store/useConfigStore', () => ({ default: {
  getState: () => config.state,
  subscribe: (listener) => {
    config.listeners.add(listener);
    return () => config.listeners.delete(listener);
  },
} }));
vi.mock('@/i18n', () => ({ default: { t: (key) => key } }));

const schema = new Schema({ nodes: {
  doc: { content: 'block+' },
  paragraph: { content: 'inline*', group: 'block', toDOM: () => ['p', 0] },
  heading: { content: 'inline*', group: 'block', attrs: { level: { default: 1 } }, toDOM: () => ['h1', 0] },
  code_block: { content: 'text*', group: 'block', code: true, attrs: { language: { default: 'js' } },
    toDOM: () => ['pre', { class: 'milkdown-code-block' }, 0] },
  bullet_list: { content: 'list_item+', group: 'block', toDOM: () => ['ul', 0] },
  list_item: { content: 'paragraph block*', toDOM: () => ['li', 0] },
  text: { group: 'inline' },
} });
const p = (text = 'body') => schema.nodes.paragraph.create(null, schema.text(text));
const views = [];
function fixture(kind = 'heading', options) {
  const block = kind === 'heading' ? schema.nodes.heading.create(null, schema.text('Heading'))
    : kind === 'code' ? schema.nodes.code_block.create(null, schema.text('code'))
      : kind === 'leaf' ? schema.nodes.bullet_list.create(null, schema.nodes.list_item.create(null, p('leaf')))
        : schema.nodes.bullet_list.create(null, schema.nodes.list_item.create(null, [
        p('parent'), schema.nodes.bullet_list.create(null, schema.nodes.list_item.create(null, p('child'))),
      ]));
  const doc = schema.nodes.doc.create(null, [block, p()]);
  const mount = document.createElement('div');
  document.body.append(mount);
  const view = new EditorView(mount, {
    state: EditorState.create({ doc, plugins: [createMilkdownHeadingFoldsPlugin(options)] }),
  });
  views.push(view);
  return { view, button: view.dom.querySelector('.md-preview__fold') };
}
function setEnabled(enabled) {
  const previous = config.state;
  config.state = { markdownFolding: enabled };
  for (const listener of config.listeners) listener(config.state, previous);
}
beforeEach(() => {
  vi.useFakeTimers();
  config.state = { markdownFolding: true };
  restoreDocumentViewStates();
});
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('synchronizes a parent with child items from a live Monaco collapse while the setting is enabled', async () => {
  let onFold;
  const decorations = () => ({ set: vi.fn(), clear: vi.fn() });
  const dispose = () => ({ dispose: vi.fn() });
  const model = {};
  const monaco = {
    createDecorationsCollection: decorations,
    getModel: () => model,
    getContribution: () => ({ getFoldingModel: () => Promise.resolve({
      onDidChange: (listener) => { onFold = listener; return dispose(); },
    }) }),
    onDidChangeModel: dispose, onMouseMove: dispose, onMouseLeave: dispose,
    saveViewState: () => ({
      contributionsState: { 'editor.contrib.folding': {
        collapsedRegions: [{ startLineNumber: 1, endLineNumber: 2, isCollapsed: true }],
      } },
    }),
  };
  const stop = bindMonacoFoldControls(monaco, () => 'nested');
  await Promise.resolve();
  onFold({ collapseStateChanged: [{ startLineNumber: 1 }] });
  const source = '- parent\n  - child\n\nbody';
  const { view, button } = fixture('item', createMilkdownFoldBridge('nested', source, () => source));
  expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(view.dom.querySelector('.md-preview__foldable-item')).toHaveAttribute('data-md-collapsed', 'true');
  stop();
  button.click();
  expect(button).toHaveAttribute('aria-expanded', 'true');
  expect(getDocumentViewState('nested', 'monaco').contributionsState['editor.contrib.folding'].collapsedRegions).toEqual([]);
  button.click();
  expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(getDocumentViewState('nested', 'monaco').contributionsState['editor.contrib.folding'].collapsedRegions)
    .toEqual([{ startLineNumber: 1, endLineNumber: 2, isCollapsed: true }]);
});

it('does not offer a fold control on a list item without child structure', () => {
  const { view, button } = fixture('leaf', createMilkdownFoldBridge('leaf', '- leaf\n\nbody', () => 'unused'));
  expect(button).toBeNull();
  expect(view.dom.querySelector('.md-preview__foldable-item')).toBeNull();
});

it.each([
  ['heading', '# Heading\n\nbody', 3],
  ['item', '- parent\n  - child\n\nbody', 2],
  ['code', '```js\ncode\n```\n\nbody', 3],
])('imports a Monaco %s fold while disabled and writes expansion back across remounts', (kind, source, end) => {
  setDocumentViewState('doc', 'monaco', {
    scrollTop: 120,
    contributionsState: {
      other: { keep: true },
      'editor.contrib.folding': { collapsedRegions: [{ startLineNumber: 1, endLineNumber: end, isCollapsed: true }] },
    },
  });
  setEnabled(false);
  const serialize = vi.fn(() => source);
  const { view, button } = fixture(kind, createMilkdownFoldBridge('doc', source, serialize));
  expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(button.hidden).toBe(false);
  expect(view.state.doc.textContent).toContain(kind === 'code' ? 'code' : kind === 'item' ? 'child' : 'body');
  button.click();
  expect(button).toHaveAttribute('data-fold-motion', 'expand');
  vi.advanceTimersByTime(160);
  expect(button.hidden).toBe(true);
  expect(getDocumentViewState('doc', 'monaco').contributionsState['editor.contrib.folding'].collapsedRegions).toEqual([]);
  expect(getDocumentViewState('doc', 'monaco').scrollTop).toBe(120);
  expect(getDocumentViewState('doc', 'monaco').contributionsState.other).toEqual({ keep: true });
  expect(serialize).not.toHaveBeenCalled();
  const remounted = fixture(kind, createMilkdownFoldBridge('doc', source, serialize));
  expect(remounted.button.hidden).toBe(true);
  remounted.button.click();
  expect(remounted.button).toHaveAttribute('aria-expanded', 'true');
  // 设置依旧关闭，Monaco 主动重新折叠后，Milkdown 才重新出现可展开的箭头。
  setDocumentViewState('doc', 'monaco', {
    contributionsState: { 'editor.contrib.folding': {
      collapsedRegions: [{ startLineNumber: 1, endLineNumber: end, isCollapsed: true }],
    } },
  });
  const refolded = fixture(kind, createMilkdownFoldBridge('doc', source, serialize));
  expect(refolded.button.hidden).toBe(false);
  expect(refolded.button).toHaveAttribute('aria-expanded', 'false');
});

it('exports a Milkdown-created fold for Monaco to restore without affecting other documents', () => {
  const { button } = fixture('heading', createMilkdownFoldBridge('doc', '# Heading\n\nbody', () => 'unused'));
  button.click();
  expect(getDocumentViewState('doc', 'monaco').contributionsState['editor.contrib.folding'].collapsedRegions)
    .toEqual([{ startLineNumber: 1, endLineNumber: 3, isCollapsed: true }]);
  expect(getDocumentViewState('other', 'monaco')).toBeUndefined();
});

it.each(['heading', 'item', 'code'])('retains collapsed %s on disabling, then rotates before hiding', (kind) => {
  const { view, button } = fixture(kind);
  button.click();
  expect(button).toHaveAttribute('aria-expanded', 'false');
  setEnabled(false);
  expect(button.hidden).toBe(false);
  expect(button).toHaveAttribute('aria-expanded', 'false');
  button.click();
  expect(view.dom.querySelector('.md-preview__fold')).toBe(button);
  expect(button).toHaveAttribute('aria-expanded', 'true');
  expect(button).toHaveClass('md-preview__fold--rotating');
  expect(button.hidden).toBe(false);
  vi.advanceTimersByTime(159);
  expect(button.hidden).toBe(false);
  vi.advanceTimersByTime(1);
  expect(button.hidden).toBe(true);
  button.click();
  expect(button).toHaveAttribute('aria-expanded', 'true');
  setEnabled(true);
  expect(button.hidden).toBe(false);
  button.click();
  expect(button).toHaveAttribute('aria-expanded', 'false');
});

it('hides expanded controls immediately when disabling without changing the document', () => {
  const { view, button } = fixture();
  const doc = view.state.doc;
  setEnabled(false);
  expect(button.hidden).toBe(true);
  expect(view.state.doc.eq(doc)).toBe(true);
});

it('does not interrupt a pending rotation on unrelated document edits', () => {
  const { view, button } = fixture();
  button.click();
  setEnabled(false);
  button.click();
  vi.advanceTimersByTime(80);
  view.dispatch(view.state.tr.insertText('edited', 1));
  expect(button.hidden).toBe(false);
  vi.advanceTimersByTime(80);
  expect(button.hidden).toBe(true);
});

it('cancels delayed hiding if the switch is enabled again during expansion', () => {
  const { button } = fixture();
  button.click();
  setEnabled(false);
  button.click();
  setEnabled(true);
  vi.advanceTimersByTime(160);
  expect(button.hidden).toBe(false);
  expect(button).not.toHaveClass('md-preview__fold--rotating');
});

it('hides immediately for reduced motion and clears timers and subscriptions on destroy', () => {
  const timers = vi.spyOn(globalThis, 'setTimeout');
  const clear = vi.spyOn(globalThis, 'clearTimeout');
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const { button } = fixture();
  button.click();
  setEnabled(false);
  button.click();
  expect(button.hidden).toBe(true);
  expect(timers.mock.calls.filter(([, delay]) => delay === 160)).toHaveLength(0);
  vi.unstubAllGlobals();
  setEnabled(true);
  button.click();
  setEnabled(false);
  button.click();
  const rotationIndex = timers.mock.calls.findIndex(([, delay]) => delay === 160);
  expect(rotationIndex).toBeGreaterThanOrEqual(0);
  const rotationTimer = timers.mock.results[rotationIndex].value;
  views.pop().destroy();
  expect(clear).toHaveBeenCalledWith(rotationTimer);
  expect(config.listeners.size).toBe(0);
});
