import * as React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ReadOnlyMarkdown from './ReadOnlyMarkdown';
import { invoke } from '@utils/tauriInvoke';

globalThis.React = React;
vi.mock('@utils/tauriInvoke', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
afterEach(() => { cleanup(); delete window.__TAURI_INTERNALS__; vi.clearAllMocks(); });
const view = (content) => render(<ReadOnlyMarkdown content={content} documentPath="/docs/a.md" dark={false} fontSize={14} lineHeight={24} />);

it('renders Markdown, math, tables and disabled tasks without an editor or run controls', () => {
  const { container } = view('# Reading\n\n- [x] Done\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n$x^2$\n\n```js\nconst x = 1;\n```');
  expect(screen.getByRole('heading', { name: 'Reading' })).toHaveAttribute('id', 'reading');
  expect(screen.getByRole('checkbox')).toBeDisabled();
  expect(screen.getByRole('checkbox')).toBeChecked();
  expect(screen.getByRole('table')).toBeInTheDocument();
  expect(container.querySelector('.katex')).not.toBeNull();
  expect(container.querySelector('.hljs-keyword')).not.toBeNull();
  expect(container.querySelector('[contenteditable],.milkdown,.monaco-editor,button')).toBeNull();
});

it('sanitizes raw HTML and preserves usable footnote anchors', () => {
  const { container } = view('Text[^one].\n\n[^one]: Note.\n\n<script>alert(1)</script><img src="javascript:alert(1)" onerror="alert(1)" />');
  expect(container.querySelector('script,[onerror],[src^="javascript:"]')).toBeNull();
  const reference = container.querySelector('a[data-footnote-ref]');
  expect(reference).not.toBeNull();
  expect(container.querySelector(`[id="${reference.getAttribute('href').slice(1)}"]`)).not.toBeNull();
});

it('opens relative Markdown links in separate readers instead of adding hidden tabs', () => {
  window.__TAURI_INTERNALS__ = {};
  view('[Next](b.md)');
  fireEvent.click(screen.getByRole('link', { name: 'Next' }));
  expect(invoke).toHaveBeenCalledWith('open_reader_window', {
    document: { id: '/docs/b.md', name: 'b.md', path: '/docs/b.md' }, x: null, y: null,
  });
});
