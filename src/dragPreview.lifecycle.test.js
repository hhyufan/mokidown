import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@utils/tauriInvoke';
import { listen } from '@tauri-apps/api/event';
import { mountDragPreview } from './dragPreview';

vi.mock('@utils/tauriInvoke', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  vi.clearAllMocks();
  listen.mockResolvedValue(vi.fn());
  invoke.mockResolvedValue(null);
});
afterEach(() => document.body.replaceChildren());

it('grants the cached preview window permission to receive updates', () => {
  const capability = JSON.parse(readFileSync('src-tauri/capabilities/drag-preview.json', 'utf8'));
  expect(capability.windows).toContain('drag-preview');
  expect(capability.permissions).toEqual(expect.arrayContaining(['core:event:allow-listen', 'core:event:allow-unlisten']));
});

it('subscribes before bootstrap and acknowledges the first visible document token', async () => {
  invoke.mockImplementation(async (command) => command === 'drag_preview_bootstrap'
    ? { token: 'drag-1', name: 'notes.md', width: 180, height: 32 } : null);
  await mountDragPreview();
  expect(listen.mock.invocationCallOrder[0]).toBeLessThan(invoke.mock.invocationCallOrder[0]);
  expect(document.getElementById('root').textContent).toBe('notes.md');
  expect(invoke).toHaveBeenLastCalledWith('drag_preview_ready', { token: 'drag-1' });
});

it('keeps the warmed window subscribed and renders a later drag without reloading', async () => {
  await mountDragPreview();
  const update = listen.mock.calls[0][1];
  update({ payload: { token: 'drag-2', name: 'later.md', width: 180, height: 32 } });
  await vi.waitFor(() => expect(invoke).toHaveBeenLastCalledWith('drag_preview_ready', { token: 'drag-2' }));
  expect(document.getElementById('root').textContent).toBe('later.md');
});
