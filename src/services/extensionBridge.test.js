import { afterEach, expect, it, vi } from 'vitest';
import { createExtensionBridge } from './extensionBridge';
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), get: vi.fn(), set: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/plugin-store', () => ({ load: async () => ({ get: mocks.get, set: mocks.set, save: mocks.save }) }));
vi.mock('@store/useEditorStore', () => ({ default: { getState: () => ({ tabs: [] }), subscribe: () => () => {} } }));
vi.mock('@utils/editorBuffer', () => ({ getBuffer: vi.fn() }));
vi.mock('./localFileGuard', () => ({ withFileOperation: (_path, action) => action() }));
afterEach(() => vi.clearAllMocks());
const entry = { package: { id: 'community.service', permissions: ['network', 'workspace.read'], fileExtensions: ['md'] }, settings: { endpoint: 'https://service.test/api', workspace: '/notes' } };
function bridge() { const port = { start: vi.fn(), close: vi.fn(), postMessage: vi.fn() }; const { dispose: stop } = createExtensionBridge(entry, port); return { port, stop }; }
it('rejects API and file paths that escape configured resources', async () => {
  const { port, stop } = bridge();
  port.onmessage({ data: { id: 1, method: 'net.request', args: { path: '/../private' } } });
  await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 1, error: expect.any(String) })));
  port.onmessage({ data: { id: 2, method: 'fs.read', args: { path: '../secret.md' } } });
  await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 2, error: expect.any(String) })));
  expect(mocks.invoke).not.toHaveBeenCalled(); stop();
});
it('drops late replies and cancels pending requests after disposal', async () => {
  let finish; mocks.invoke.mockImplementation((_command) => new Promise((resolve) => { finish = resolve; }));
  const { port, stop } = bridge();
  port.onmessage({ data: { id: 1, method: 'net.request', args: { path: '/items' } } });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  const reply = finish; stop(); reply({ status: 200, body: '{}' });
  await Promise.resolve(); await Promise.resolve();
  expect(port.close).toHaveBeenCalledTimes(1);
  expect(port.postMessage).not.toHaveBeenCalled();
  expect(mocks.invoke).toHaveBeenCalledWith('extension_cancel_request', expect.any(Object));
});
