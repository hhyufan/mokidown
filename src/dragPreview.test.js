import { afterEach, expect, it } from 'vitest';
import { buildDragPreview } from './services/readerWindows';
import { createDragPreviewElement } from './dragPreview';

afterEach(() => { document.body.replaceChildren(); });

it('renders the same fixed-size snapshot in both windows, including child spacing and typography', () => {
  const ghost = document.createElement('div');
  ghost.className = 'file-tree__item';
  ghost.dataset.readerName = '02-desktop.md';
  Object.assign(ghost.style, {
    width: '212px', height: '32px', minWidth: '100%', fontSize: '12px',
    display: 'flex', gap: '6px', padding: '0 14px', borderRadius: '5px',
  });
  ghost.innerHTML = '<span style="width:18px;flex-shrink:0">M</span><span style="line-height:20px">02-desktop.md</span>';
  document.body.append(ghost);
  const preview = buildDragPreview(ghost);
  const native = createDragPreviewElement(preview);
  document.body.append(native);
  expect(native.style.width).toBe('212px');
  expect(native.style.minWidth).toBe('0');
  expect(native.style.maxWidth).toBe('212px');
  expect(native.style.height).toBe('32px');
  expect(native.style.fontSize).toBe('12px');
  expect(native.style.gap).toBe('6px');
  expect(native.style.borderRadius).toBe('5px');
  expect(native.children[0].style.width).toBe('18px');
  expect(native.children[1].style.lineHeight).toBe('20px');
  expect(native.textContent).toBe(ghost.textContent);
  expect(native.style.transform).toBe('none');
});

it('does not carry interactive handlers, classes or identifiers into the preview', () => {
  const ghost = document.createElement('div');
  ghost.id = 'source';
  ghost.innerHTML = '<span id="label" onclick="alert(1)">notes.md</span><button>Close</button><script>alert(1)</script>';
  document.body.append(ghost);
  const native = createDragPreviewElement(buildDragPreview(ghost));
  expect(native.id).toBe('');
  expect(native.querySelector('script,button,[onclick],[id]')).toBeNull();
  expect(native.textContent).toBe('notes.md');
});

it('renders visible text and icons from an invisible measurement node', () => {
  const ghost = document.createElement('div');
  ghost.style.visibility = 'hidden';
  ghost.innerHTML = '<span style="visibility:hidden">M</span><span>notes.md</span>';
  document.body.append(ghost);
  const native = createDragPreviewElement(buildDragPreview(ghost));
  document.body.append(native);
  expect(getComputedStyle(native).visibility).toBe('visible');
  for (const child of native.children) expect(getComputedStyle(child).visibility).toBe('visible');
});

it('clears logical insets so the rendered origin matches native grab-offset arithmetic', () => {
  const ghost = document.createElement('div');
  Object.assign(ghost.style, {
    position: 'fixed', left: '0px', top: '0px', insetBlockStart: '0px',
    insetInlineStart: '0px', marginInlineStart: '10px', width: '200px', height: '36px',
  });
  ghost.textContent = 'notes.md';
  document.body.append(ghost);
  const native = createDragPreviewElement(buildDragPreview(ghost));
  expect(native.style.insetBlockStart).toBe('');
  expect(native.style.insetInlineStart).toBe('');
  expect(native.style.marginInlineStart).toBe('');
  expect(native.style.left).toBe('24px');
  expect(native.style.top).toBe('24px');
});
