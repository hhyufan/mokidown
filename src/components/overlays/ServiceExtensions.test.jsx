import * as React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import useExtensionStore, { OFFICIAL_EXTENSIONS } from '@store/useExtensionStore';
import ServiceExtensions from './ServiceExtensions';
import i18n from '@/i18n';

globalThis.React = React;
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { cleanup(); useExtensionStore.setState({ installed: [], catalog: [], catalogUrl: '', error: '' }); vi.unstubAllGlobals(); vi.restoreAllMocks(); delete window.__TAURI_INTERNALS__; });

it('shows official built-in plugins immediately without requesting a remote catalog or package', async () => {
  await i18n.changeLanguage('zh');
  const fetchPackage = vi.fn(); vi.stubGlobal('fetch', fetchPackage);
  window.__TAURI_INTERNALS__ = {};
  render(<ServiceExtensions />);
  expect(screen.getByText(OFFICIAL_EXTENSIONS[0].name)).toBeInTheDocument();
  expect(screen.getByText('官方内置')).toBeInTheDocument();
  expect(screen.getByText('未启用')).toBeInTheDocument();
  expect(screen.getByLabelText('GitHub 插件清单 URL')).not.toBeVisible();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(invoke).not.toHaveBeenCalled(); expect(fetchPackage).not.toHaveBeenCalled();
});

it('starts a built-in package on demand and preserves the configured service when stopped', async () => {
  await i18n.changeLanguage('zh'); window.__TAURI_INTERNALS__ = {};
  const descriptor = OFFICIAL_EXTENSIONS[0];
  useExtensionStore.getState().install({ ...descriptor, format: 'mokidown-extension-v1', script: '/* separate package */' });
  useExtensionStore.setState((state) => ({ installed: state.installed.map((entry) => ({ ...entry, settings: { endpoint: 'https://service.test' } })) }));
  render(<ServiceExtensions />);
  fireEvent.click(screen.getByRole('switch', { name: descriptor.name }));
  await waitFor(() => expect(useExtensionStore.getState().installed[0].enabled).toBe(true));
  fireEvent.click(screen.getByRole('switch', { name: descriptor.name }));
  await waitFor(() => expect(useExtensionStore.getState().installed[0].enabled).toBe(false));
  expect(useExtensionStore.getState().installed[0].settings.endpoint).toBe('https://service.test');
});
