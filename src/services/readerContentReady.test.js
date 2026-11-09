import { afterEach, expect, it, vi } from 'vitest';
import { afterPaint } from './readerOpening';
import { waitForReaderContent } from './readerContentReady';

vi.mock('./readerOpening', () => ({ afterPaint: vi.fn().mockResolvedValue(undefined) }));
afterEach(() => { document.body.replaceChildren(); vi.clearAllMocks(); });

it('waits for asynchronous Markdown nodes and image decoding before signaling readiness', async () => {
  const root = document.createElement('article');
  root.innerHTML = '<div data-reader-pending></div><img alt="" />';
  document.body.append(root);
  let decoded;
  root.querySelector('img').decode = vi.fn(() => new Promise((resolve) => { decoded = resolve; }));
  let ready = false;
  const task = waitForReaderContent(root).then(() => { ready = true; });
  await Promise.resolve();
  expect(ready).toBe(false);
  expect(afterPaint).not.toHaveBeenCalled();
  root.firstChild.removeAttribute('data-reader-pending');
  await vi.waitFor(() => expect(root.querySelector('img').decode).toHaveBeenCalled());
  expect(ready).toBe(false);
  decoded();
  await task;
  expect(afterPaint).toHaveBeenCalledTimes(1);
  expect(ready).toBe(true);
});

it('does not wait for lazy media outside the visible document', async () => {
  const root = document.createElement('article');
  root.innerHTML = '<div data-reader-pending></div>';
  root.getBoundingClientRect = () => ({ top: 0, bottom: 720 });
  root.firstChild.getBoundingClientRect = () => ({ top: 1000, bottom: 1200 });
  await waitForReaderContent(root);
  expect(afterPaint).toHaveBeenCalledTimes(1);
});

it('allows readable content to appear when an asset never finishes', async () => {
  const root = document.createElement('article');
  root.innerHTML = '<div data-reader-pending></div>';
  await waitForReaderContent(root, undefined, 10);
  expect(afterPaint).toHaveBeenCalledTimes(1);
});

it('does not signal readiness for a disposed renderer', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(waitForReaderContent(document.createElement('article'), controller.signal))
    .rejects.toMatchObject({ name: 'AbortError' });
  expect(afterPaint).not.toHaveBeenCalled();
});
