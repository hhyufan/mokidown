import * as React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import useExtensionStore from '@store/useExtensionStore';
import ExtensionHost from './ExtensionHost';

globalThis.React = React;
const mocks = vi.hoisted(() => ({ stop: vi.fn(), bridge: vi.fn() }));
vi.mock('@/services/extensionBridge', () => ({ createExtensionBridge: (...args) => { mocks.bridge(...args); return { dispose: mocks.stop, send: vi.fn() }; } }));
vi.mock('antd', () => ({ Button: ({ children, ...props }) => <button {...props}>{children}</button> }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));
afterEach(() => { cleanup(); useExtensionStore.setState({ installed: [], activeId: null }); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('creates no plugin realm while disabled and disposes the whole realm when stopped', () => {
  vi.stubGlobal('MessageChannel', class { port1 = {}; port2 = {}; });
  const pkg = { format: 'mokidown-extension-v1', id: 'community.service', name: 'Independent service', version: '1', permissions: [], fileExtensions: [], script: '/* independent package */' };
  useExtensionStore.getState().install(pkg);
  const { container } = render(<ExtensionHost />);
  expect(container.querySelector('iframe')).toBeNull(); expect(mocks.bridge).not.toHaveBeenCalled();
  act(() => useExtensionStore.getState().toggle(pkg.id, true));
  expect(screen.getByTitle(pkg.name)).toHaveAttribute('sandbox', 'allow-scripts');
  expect(screen.getByTitle(pkg.name)).not.toBeVisible();
  expect(screen.queryByRole('button')).toBeNull();
  expect(container.querySelector('.extension-host')).toBeNull();
  expect(mocks.bridge).toHaveBeenCalledTimes(1);
  act(() => useExtensionStore.getState().toggle(pkg.id, false));
  expect(container.querySelector('iframe')).toBeNull(); expect(mocks.stop).toHaveBeenCalledTimes(1);
});
