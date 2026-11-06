import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import VirtualFileList from './VirtualFileList';
import { fileWindow, FILE_ROW_HEIGHT, MAX_SCROLL_HEIGHT, MAX_FILE_OVERSCAN, FILE_SCROLL_IDLE_MS } from '@utils/virtualFileWindow';

globalThis.React = React;
let frames;
let now;
let frameId;
function paint() {
  now += 16;
  const callbacks = [...frames.values()];
  frames.clear();
  act(() => callbacks.forEach((callback) => callback(now)));
}
beforeEach(() => {
  vi.useFakeTimers();
  frames = new Map(); now = 0; frameId = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id) => frames.delete(id));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const row = (index, style, { deferDetails }) => <div key={index} role="listitem" data-index={index} data-details={deferDetails ? 'deferred' : 'ready'} style={style}>note{index}.md</div>;

it('renders ten million logical files with bounded DOM and reaches the exact last row', () => {
  const range = vi.fn();
  const { container, getByRole } = render(<VirtualFileList count={10_000_000} renderRow={row} onRangeChange={range} />);
  const list = getByRole('list');
  expect(container.querySelectorAll('[role=listitem]').length).toBeLessThan(30);
  expect(list.firstElementChild.style.height).toBe(`${MAX_SCROLL_HEIGHT}px`);
  expect(container.querySelector('[data-index="0"]')).toBeInTheDocument();
  fireEvent.keyDown(list, { key: 'End' });
  paint();
  expect(container.querySelector('[data-index="9999999"]')).toBeInTheDocument();
  expect(container.querySelector('[data-index="0"]')).not.toBeInTheDocument();
  expect(container.querySelectorAll('[role=listitem]').length).toBeLessThan(30);
  expect(range).toHaveBeenLastCalledWith(expect.any(Number), 10_000_000, expect.objectContaining({ visibleEnd: 10_000_000 }));
  fireEvent.keyDown(list, { key: 'Home' });
  paint();
  expect(container.querySelector('[data-index="0"]')).toBeInTheDocument();
});

it('keeps wheel movement at one logical row and maps scrollbar dragging across the entire dataset', () => {
  const { container, getByRole } = render(<VirtualFileList count={10_000_000} renderRow={row} />);
  const list = getByRole('list');
  fireEvent.wheel(list, { deltaY: FILE_ROW_HEIGHT * 20 });
  paint();
  expect(container.querySelector('[data-index="20"]')).toBeInTheDocument();
  expect(container.querySelector('[data-index="0"]')).not.toBeInTheDocument();
  list.scrollTop = (MAX_SCROLL_HEIGHT - 320) / 2;
  fireEvent.scroll(list);
  paint();
  expect(container.querySelector('[data-index="5000000"]')).toBeInTheDocument();
  expect(container.querySelectorAll('[role=listitem]').length).toBeLessThan(80);
});

it('retains an edited row while it leaves the viewport and handles shrinking or empty lists', () => {
  const { container, getByRole, rerender } = render(<VirtualFileList count={10_000_000} renderRow={row} pinnedIndex={0} />);
  const first = container.querySelector('[data-index="0"]');
  fireEvent.keyDown(getByRole('list'), { key: 'End' });
  paint();
  expect(container.querySelector('[data-index="0"]')).toBe(first);
  rerender(<VirtualFileList count={3} renderRow={row} />);
  expect(container.querySelectorAll('[role=listitem]').length).toBe(3);
  rerender(<VirtualFileList count={0} renderRow={row} />);
  expect(container.querySelectorAll('[role=listitem]').length).toBe(0);
});

it('batches wheel bursts into one frame, defers rich rows, and restores them after scrolling stops', () => {
  const range = vi.fn();
  const { container, getByRole } = render(<VirtualFileList count={10_000_000} renderRow={row} onRangeChange={range} />);
  const list = getByRole('list');
  for (let i = 0; i < 100; i += 1) fireEvent.wheel(list, { deltaY: FILE_ROW_HEIGHT });
  expect(range).toHaveBeenCalledTimes(1);
  expect(frames.size).toBe(1);
  paint();
  expect(range).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[data-index="100"]')).toHaveAttribute('data-details', 'deferred');
  expect(list).toHaveAttribute('data-scrolling', 'fast');
  expect(container.querySelectorAll('[role=listitem]').length).toBeLessThan(80);
  act(() => vi.advanceTimersByTime(FILE_SCROLL_IDLE_MS));
  expect(container.querySelector('[data-index="100"]')).toHaveAttribute('data-details', 'ready');
  expect(list).toHaveAttribute('data-scrolling', 'idle');
  expect(container.querySelectorAll('[role=listitem]').length).toBeLessThan(30);
});

it('expands only the forward buffer and bounds it at any scroll velocity', () => {
  const forward = fileWindow(10_000_000, 640, 5000 * FILE_ROW_HEIGHT, FILE_ROW_HEIGHT, 1_000_000);
  const reverse = fileWindow(10_000_000, 640, 5000 * FILE_ROW_HEIGHT, FILE_ROW_HEIGHT, -1_000_000);
  expect(forward.end - forward.visibleEnd).toBe(MAX_FILE_OVERSCAN);
  expect(forward.visibleStart - forward.start).toBe(6);
  expect(reverse.visibleStart - reverse.start).toBe(MAX_FILE_OVERSCAN);
  expect(reverse.end - reverse.visibleEnd).toBe(6);
});

it('never defers an active rename row and cancels pending work on unmount', () => {
  const { container, getByRole, unmount } = render(<VirtualFileList count={10_000_000} renderRow={row} pinnedIndex={0} />);
  fireEvent.keyDown(getByRole('list'), { key: 'End' }); paint();
  expect(container.querySelector('[data-index="0"]')).toHaveAttribute('data-details', 'ready');
  fireEvent.keyDown(getByRole('list'), { key: 'Home' });
  expect(frames.size).toBe(1);
  unmount();
  expect(frames.size).toBe(0);
  act(() => vi.advanceTimersByTime(FILE_SCROLL_IDLE_MS));
});

it('does not retain phantom wheel deltas if a snapshot clears before the pending frame', () => {
  const { container, getByRole, rerender } = render(<VirtualFileList count={10_000_000} renderRow={row} />);
  fireEvent.wheel(getByRole('list'), { deltaY: 320_000 });
  rerender(<VirtualFileList count={0} renderRow={row} />);
  paint();
  rerender(<VirtualFileList count={10_000_000} renderRow={row} />);
  fireEvent.wheel(getByRole('list'), { deltaY: FILE_ROW_HEIGHT });
  paint();
  expect(container.querySelector('[data-index="1"]')).toBeInTheDocument();
  expect(container.querySelector('[data-index="10001"]')).not.toBeInTheDocument();
});

it('computes stable windows at boundaries without allocating one entry per file', () => {
  for (const count of [0, 1, 1_000, 10_000_000]) {
    for (const offset of [0, 123456, count * FILE_ROW_HEIGHT, Number.MAX_SAFE_INTEGER]) {
      const window = fileWindow(count, 640, offset);
      expect(window.physicalHeight).toBeLessThanOrEqual(MAX_SCROLL_HEIGHT);
      expect(window.end - window.start).toBeLessThanOrEqual(33);
      expect(window.logicalOffset).toBeLessThanOrEqual(window.logicalMax);
      expect(window.end).toBeLessThanOrEqual(count);
      expect(window.start).toBeGreaterThanOrEqual(0);
    }
  }
});

it('requests fresh pages for a replaced snapshot even when its row count and viewport are unchanged', () => {
  const range = vi.fn();
  const { rerender } = render(<VirtualFileList count={10_000_000} renderRow={row} onRangeChange={range} dataVersion="first" />);
  expect(range).toHaveBeenCalledTimes(1);
  rerender(<VirtualFileList count={10_000_000} renderRow={row} onRangeChange={range} dataVersion="second" />);
  expect(range).toHaveBeenCalledTimes(2);
});

it('commits out-of-window jumps inside the frame without a loading surface', () => {
  const { container, getByRole } = render(<VirtualFileList count={10_000_000} renderRow={row} />);
  fireEvent.keyDown(getByRole('list'), { key: 'End' });
  expect(container.querySelector('.file-tree__viewport')).not.toHaveAttribute('data-pending');
  expect(container.querySelector('.file-tree__loading-guard')).toBeNull();
  paint();
  expect(container.querySelector('[data-index="9999999"]').style.top).toBe('288px');
});

it('moves resident rows immediately without hiding filenames for a covered scroll', () => {
  const { container, getByRole } = render(<VirtualFileList count={10_000_000} renderRow={row} />);
  fireEvent.wheel(getByRole('list'), { deltaY: FILE_ROW_HEIGHT });
  expect(container.querySelector('.file-tree__viewport')).not.toHaveAttribute('data-pending');
  expect(container.querySelector('.file-tree__rows').style.transform).toBe('translateY(-32px)');
  paint();
  expect(container.querySelector('.file-tree__rows').style.transform).toBe('');
  expect(container.querySelector('[data-index="1"]').style.top).toBe('0px');
});

it('retains resident filenames without skeletons while a jumped-to page is loading', () => {
  let loaded = false;
  const { container, getByRole, rerender } = render(<VirtualFileList count={10_000_000} renderRow={row} isRowReady={(index) => index < 100 || loaded} />);
  fireEvent.keyDown(getByRole('list'), { key: 'End' }); paint();
  expect(container.querySelector('[data-index="0"]')).toBeInTheDocument();
  expect(getByRole('list')).toHaveAttribute('aria-busy', 'true');
  expect(container.querySelector('.file-tree__loading-guard, .file-tree__item--pending')).toBeNull();
  loaded = true;
  rerender(<VirtualFileList count={10_000_000} renderRow={row} isRowReady={() => true} dataVersion={1} />);
  expect(container.querySelector('[data-index="9999999"]')).toBeInTheDocument();
  expect(getByRole('list')).not.toHaveAttribute('aria-busy');
});

it('unmounts a cancelled pinned input even while the next viewport page is unavailable', () => {
  const renderRow = (index, style) => <div role="listitem" style={style}>{index === 0 ? <input aria-label="New file" /> : `note${index}.md`}</div>;
  const { getByRole, queryByRole, rerender } = render(<VirtualFileList count={10_000_000} renderRow={renderRow} pinnedIndex={0} isRowReady={(index) => index < 100} />);
  fireEvent.keyDown(getByRole('list'), { key: 'End' }); paint();
  expect(getByRole('textbox', { name: 'New file' })).toBeInTheDocument();
  rerender(<VirtualFileList count={10_000_000} renderRow={row} pinnedIndex={-1} isRowReady={() => false} />);
  expect(queryByRole('textbox', { name: 'New file', hidden: true })).toBeNull();
});
