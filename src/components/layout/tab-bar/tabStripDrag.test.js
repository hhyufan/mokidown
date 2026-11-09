import { afterEach, expect, it, vi } from 'vitest';
import { installTabStripDrag } from './tabStripDrag';

let cleanup;
afterEach(() => { cleanup?.(); document.body.innerHTML = ''; });
function fixture(detachable = false, options = {}) {
  document.body.innerHTML = '<div id="tabs"><div data-tab-id="a"><span>A</span><input /><button>close</button></div><div data-tab-id="b">B</div><div data-tab-id="c">C</div></div>';
  const container = document.querySelector('#tabs');
  container.setPointerCapture = vi.fn();
  container.hasPointerCapture = () => false;
  container.scrollBy = vi.fn();
  container.getBoundingClientRect = () => ({ left: 0, right: 300, top: 0, bottom: 40 });
  [...container.children].forEach((tab, index) => { tab.getBoundingClientRect = () => ({ left: index * 100, right: (index + 1) * 100, width: 100 }); });
  const callbacks = { onDragChange: vi.fn(), onDropTarget: vi.fn(), onReorder: vi.fn(),
    ...(detachable ? { onDetach: vi.fn() } : {}) };
  cleanup = installTabStripDrag(container, { ...callbacks, ...options });
  const pointer = (type, x, target = container.firstChild.firstChild, y = 0) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, screenX: x - 1920, screenY: y, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    target.dispatchEvent(event);
  };
  return { container, pointer, ...callbacks };
}
it('reorders after a pointer drag without native HTML drag events', () => {
  const { pointer, onReorder, onDragChange, container } = fixture();
  pointer('pointerdown', 30); pointer('pointermove', 280, window); pointer('pointerup', 280, window);
  expect(onReorder).toHaveBeenCalledWith('a', 'c', true);
  expect(onDragChange).toHaveBeenLastCalledWith(null);
  expect(container.firstChild.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(false);
});
it('follows the pointer with a ghost copy of the dragged tab', () => {
  const { pointer } = fixture();
  pointer('pointerdown', 30); pointer('pointermove', 130, window);
  const ghost = document.querySelector('.tabbar__tab-ghost');
  expect(ghost).toBeTruthy();
  expect(ghost.textContent).toBe('A');
  expect(ghost.hasAttribute('data-tab-id')).toBe(false);
  expect(ghost.querySelector('input, button, .tabbar__tab-close')).toBeNull();
  expect(ghost.style.transform).toContain('translate3d');
  pointer('pointerup', 130, window);
  expect(document.querySelector('.tabbar__tab-ghost')).toBeNull();
});

it('passes the original grab offset and a unique token to the native preview', () => {
  const onGhost = vi.fn();
  const { pointer } = fixture(true, { onGhost, nativeTracking: true });
  pointer('pointerdown', 30, undefined, 20);
  pointer('pointermove', 130, window, 20);
  expect(onGhost).toHaveBeenCalledWith('a', expect.any(HTMLElement), expect.any(HTMLElement),
    expect.objectContaining({ offsetX: 30, offsetY: 0, token: expect.any(String) }));
});

it('removes label truncation before measuring the ghost for native handoff', () => {
  const { pointer, container } = fixture();
  const name = container.firstChild.firstChild;
  name.className = 'tabbar__tab-name';
  name.textContent = '完整的长文件名称不应在拖拽时被截断.md';
  Object.assign(name.style, { maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis' });
  pointer('pointerdown', 30);
  pointer('pointermove', 130, window);
  const ghost = document.querySelector('.tabbar__tab-ghost');
  expect(ghost.style.width).toBe('max-content');
  expect(ghost.style.maxWidth).toBe('none');
  expect(ghost.querySelector('.tabbar__tab-name').style.textOverflow).toBe('clip');
  expect(ghost.querySelector('.tabbar__tab-name').style.maxWidth).toBe('none');
});

it('preserves the exact point grabbed in a tab below the title bar', () => {
  const onGhost = vi.fn();
  const { pointer, container } = fixture(true, { onGhost });
  container.firstChild.getBoundingClientRect = () => ({ left: 20, top: 44, right: 220, width: 200, height: 36 });
  pointer('pointerdown', 90, undefined, 65);
  pointer('pointermove', 190, window, 165);
  const ghost = document.querySelector('.tabbar__tab-ghost');
  expect(onGhost.mock.calls[0][3]).toMatchObject({ offsetX: 70, offsetY: 21 });
  expect(ghost.style.transform).toBe('translate3d(120px, 144px, 0)');
});

it('accepts text-node drag targets and safely ignores document/window targets', () => {
  const { container } = fixture();
  const errors = [];
  const error = (event) => errors.push(event.error);
  window.addEventListener('error', error);
  try {
    const text = container.firstChild.firstChild.firstChild;
    expect(text.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true }))).toBe(false);
    for (const target of [document, window]) {
      const event = new Event('dragstart', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'target', { value: target });
      container.dispatchEvent(event);
    }
    expect(errors).toEqual([]);
  } finally { window.removeEventListener('error', error); }
});

it('uses only the native surface across the edge and keeps tracking across blur and capture loss', () => {
  const { pointer, container, onDetach, onDragChange } = fixture(true, { nativeTracking: true });
  pointer('pointerdown', 30);
  pointer('pointermove', 130, window);
  const ghost = document.querySelector('.tabbar__tab-ghost');
  expect(ghost.style.visibility).toBe('hidden');
  window.dispatchEvent(new Event('blur'));
  container.dispatchEvent(new Event('lostpointercapture'));
  expect(onDetach).not.toHaveBeenCalled();
  expect(ghost.isConnected).toBe(true);
  window.dispatchEvent(new CustomEvent('reader:native-drag-end', { detail: ghost.dataset.previewToken }));
  expect(ghost.isConnected).toBe(false);
  expect(onDragChange).toHaveBeenLastCalledWith(null);
  expect(onDetach).not.toHaveBeenCalled();
});

it('restores a visible fallback if native initialization fails, ignoring stale failures', () => {
  const { pointer } = fixture(true, { nativeTracking: true });
  pointer('pointerdown', 30);
  pointer('pointermove', 130, window);
  const ghost = document.querySelector('.tabbar__tab-ghost');
  window.dispatchEvent(new CustomEvent('reader:native-preview-failed', { detail: 'stale-token' }));
  expect(ghost.style.visibility).toBe('hidden');
  window.dispatchEvent(new CustomEvent('reader:native-preview-failed', { detail: ghost.dataset.previewToken }));
  expect(ghost.style.visibility).toBe('visible');
});
it('preserves ordinary clicks and small mouse movements', () => {
  const { pointer, onReorder, container } = fixture();
  pointer('pointerdown', 30); pointer('pointermove', 32); pointer('pointerup', 32);
  expect(onReorder).not.toHaveBeenCalled();
  expect(container.setPointerCapture).not.toHaveBeenCalled();
  expect(container.firstChild.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(true);
});
it('cancels with Escape instead of moving a tab', () => {
  const { pointer, onReorder, onDragChange } = fixture();
  pointer('pointerdown', 30); pointer('pointermove', 180);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  pointer('pointerup', 180);
  expect(onReorder).not.toHaveBeenCalled();
  expect(onDragChange).toHaveBeenLastCalledWith(null);
});
it('does not start dragging from rename inputs or close buttons', () => {
  const { container, pointer, onReorder } = fixture();
  for (const target of container.querySelectorAll('input,button')) {
    pointer('pointerdown', 30, target); pointer('pointermove', 280); pointer('pointerup', 280);
  }
  expect(onReorder).not.toHaveBeenCalled();
});
it('scrolls at the strip edge and cancels when the pointer is interrupted', () => {
  const { container, pointer, onReorder, onDragChange } = fixture();
  pointer('pointerdown', 30); pointer('pointermove', 299);
  expect(container.scrollBy).toHaveBeenCalledWith({ left: 10, behavior: 'instant' });
  pointer('pointercancel', 299, container);
  pointer('pointerup', 299);
  expect(onReorder).not.toHaveBeenCalled();
  expect(onDragChange).toHaveBeenLastCalledWith(null);
});

it('detaches after a vertical drag, preserving negative multi-monitor coordinates', () => {
  const { pointer, onDetach, onReorder } = fixture(true);
  pointer('pointerdown', 30, undefined, 20);
  pointer('pointermove', 30, window, 160);
  pointer('pointerup', 30, window, 160);
  expect(onDetach).toHaveBeenCalledWith('a', { screenX: -1890, screenY: 160 });
  expect(onReorder).not.toHaveBeenCalled();
});

it('detaches when the pointer leaves the strip horizontally', () => {
  const { pointer, onDetach, onReorder } = fixture(true);
  pointer('pointerdown', 30, undefined, 20);
  pointer('pointermove', 350, window, 20);
  pointer('pointerup', 350, window, 20);
  expect(onDetach).toHaveBeenCalledWith('a', { screenX: -1570, screenY: 20 });
  expect(onReorder).not.toHaveBeenCalled();
});

it('reorders when a dragged-out tab returns to the strip before release', () => {
  const { pointer, onDetach, onReorder } = fixture(true);
  pointer('pointerdown', 30, undefined, 20);
  pointer('pointermove', 30, window, 160);
  pointer('pointerup', 180, window, 20);
  expect(onDetach).not.toHaveBeenCalled();
  expect(onReorder).toHaveBeenCalledWith('a', 'b', true);
});

it('cancels a detach on Escape or pointer interruption', () => {
  const { pointer, onDetach, container } = fixture(true);
  pointer('pointerdown', 30, undefined, 20);
  pointer('pointermove', 30, window, 160);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  pointer('pointerup', 30, window, 160);
  pointer('pointerdown', 30, undefined, 20);
  pointer('pointermove', 30, window, 160);
  pointer('pointercancel', 30, container, 160);
  expect(onDetach).not.toHaveBeenCalled();
});

it('detaches when the window loses focus during an active drag', () => {
  const { pointer, onDetach, onDragChange } = fixture(true);
  pointer('pointerdown', 30, undefined, 20);
  pointer('pointermove', 30, window, 160);
  window.dispatchEvent(new Event('blur'));
  pointer('pointerup', 30, window, 160);
  expect(onDetach).toHaveBeenCalledWith('a', { screenX: -1890, screenY: 160 });
  expect(onDragChange).toHaveBeenLastCalledWith(null);
});
