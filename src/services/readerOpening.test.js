import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@utils/tauriInvoke';
import { expandReader, openingClip, revealReader } from './readerOpening';

vi.mock('@utils/tauriInvoke', () => ({ invoke: vi.fn() }));
const preview = { token: 'drag-1', width: 180, height: 36 };
let root;
let card;
let frames;
beforeEach(() => {
  vi.clearAllMocks();
  invoke.mockResolvedValue(undefined);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  frames = [];
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
    frames.push(callback);
    return frames.length;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  root = document.createElement('main');
  card = document.createElement('div');
  card.className = 'reader__title';
  root.append(card);
  document.body.append(root);
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

async function paint() {
  for (let i = 0; i < 2; i++) {
    const batch = frames.splice(0);
    batch.forEach((callback) => callback());
    await Promise.resolve();
  }
}

it('preserves the original card origin when the final window is clamped to a monitor', () => {
  expect(openingClip(preview, { offsetX: 320, offsetY: 150 }))
    .toBe('inset(150px calc(100% - 500px) calc(100% - 186px) 320px round 6px)');
});

it('keeps the native preview until the replacement paints and uses no per-frame window calls', async () => {
  let finishRoot;
  let finishCard;
  root.animate = vi.fn(() => ({ finished: new Promise((resolve) => { finishRoot = resolve; }), cancel: vi.fn() }));
  card.animate = vi.fn(() => ({ finished: new Promise((resolve) => { finishCard = resolve; }), cancel: vi.fn() }));
  const task = expandReader(root, preview, { offsetX: 0, offsetY: 0 }, new AbortController().signal);
  await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0));
  expect(invoke).toHaveBeenCalledWith('reader_present', { focus: false });
  expect(invoke).not.toHaveBeenCalledWith('close_drag_preview', expect.anything());
  await paint();
  await vi.waitFor(() => expect(root.animate).toHaveBeenCalledTimes(1));
  expect(invoke).toHaveBeenCalledWith('close_drag_preview', { token: 'drag-1' });
  finishRoot();
  finishCard();
  await task;
  expect(invoke.mock.calls.map(([name]) => name)).toEqual(['reader_present', 'close_drag_preview']);
  expect(root.style.clipPath).toBe('');
});

it('skips motion but still waits for handoff paints in reduced-motion mode', async () => {
  window.matchMedia.mockReturnValue({ matches: true });
  root.animate = vi.fn();
  card.animate = vi.fn();
  const task = expandReader(root, preview, { offsetX: 0, offsetY: 0 });
  await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0));
  await paint();
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('reader_present', { focus: false }));
  await paint();
  await task;
  expect(root.animate).not.toHaveBeenCalled();
  expect(root.style.clipPath).toBe('');
});

it('does not show a disposed reader or hide a newer preview', async () => {
  const controller = new AbortController();
  const task = expandReader(root, preview, { offsetX: 0, offsetY: 0 }, controller.signal);
  const result = expect(task).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await result;
  expect(invoke).not.toHaveBeenCalled();
  expect(root.style.clipPath).toBe('');
});

it('decodes the background and card concurrently without showing partially prepared assets', async () => {
  const icon = document.createElement('img');
  card.append(icon);
  let finishIcon;
  let finishBackground;
  icon.decode = vi.fn(() => new Promise((resolve) => { finishIcon = resolve; }));
  const decodeBackground = vi.fn(() => new Promise((resolve) => { finishBackground = resolve; }));
  vi.stubGlobal('Image', class { decode = decodeBackground; });
  const task = expandReader(root, preview, { offsetX: 0, offsetY: 0 }, undefined, 'background.jpg');
  expect(icon.decode).toHaveBeenCalledTimes(1);
  expect(decodeBackground).toHaveBeenCalledTimes(1);
  expect(invoke).not.toHaveBeenCalled();
  finishBackground();
  await Promise.resolve();
  expect(invoke).not.toHaveBeenCalled();
  finishIcon();
  await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0));
  await paint();
  await task;
  expect(invoke).toHaveBeenCalledWith('reader_present', { focus: false });
});

it('paints the mounted document before fading its retained cover', async () => {
  card.animate = vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn() }));
  const task = revealReader(card, null);
  await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0));
  expect(card.animate).not.toHaveBeenCalled();
  await paint();
  await task;
  expect(card.animate).toHaveBeenCalledWith([{ opacity: 1 }, { opacity: 0 }], expect.objectContaining({ duration: 240 }));
  expect(card.style.opacity).toBe('0');
});

it('keeps the cover transparent after fade completion until React removes it', async () => {
  let finish;
  const cancel = vi.fn(() => expect(card.style.opacity).toBe('0'));
  card.animate = vi.fn(() => ({ finished: new Promise((resolve) => { finish = resolve; }), cancel }));
  const task = revealReader(card, null);
  await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0));
  await paint();
  await vi.waitFor(() => expect(card.animate).toHaveBeenCalledTimes(1));
  finish();
  await task;
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(card.style.opacity).toBe('0');
});

it('expands the rendered window directly without animating an opacity overlay', async () => {
  const cover = document.createElement('div');
  cover.className = 'reader__opening-cover';
  root.append(cover);
  root.animate = vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn() }));
  card.animate = vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn() }));
  cover.animate = vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn() }));
  const task = expandReader(root, preview, { offsetX: 0, offsetY: 0 });
  await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0));
  await paint();
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('reader_present', { focus: false }));
  await paint();
  await task;
  expect(root.animate).toHaveBeenCalledTimes(1);
  expect(cover.animate).not.toHaveBeenCalled();
  expect(card.animate.mock.calls[0][0].every((frame) => !('opacity' in frame))).toBe(true);
  expect(card.style.opacity).toBe('');
});

it('moves the snapshot and final title to the same origin while opening diagonally at full content scale', async () => {
  const title = card;
  for (const element of [root, card, title]) {
    element.animate = vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn() }));
  }
  const translation = 'translate(320px, 150px)';
  const task = expandReader(root, preview, { offsetX: 320, offsetY: 150 });
  await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0));
  expect(card.style.transform).toBe(translation);
  expect(title.style.transform).toBe(translation);
  await paint();
  await task;
  expect(root.animate).toHaveBeenCalledWith([
    { clipPath: openingClip(preview, { offsetX: 320, offsetY: 150 }) },
    { clipPath: 'inset(0px 0px 0px 0px round 0px)' },
  ], expect.objectContaining({ duration: 300 }));
  expect(card.animate.mock.calls[0][0].at(-1).transform).toBe('translate(0px, 0px)');
  expect(title.animate.mock.calls[0][0].at(-1).transform).toBe('translate(0px, 0px)');
  expect(root.style.transform).toBe('');
  expect(title.style.opacity).toBe('');
  expect(title.style.transform).toBe('');
});
