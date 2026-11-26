import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import useConfigStore from '@store/useConfigStore';
import useLspStore from '@store/useLspStore';
import {
  getImageHostRule,
  loadSettingsDocument,
  prepareSettingsDocumentSave,
} from './settingsDocuments';
import { settingsDocumentKind } from './settingsDocumentPaths';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@utils/tauriApi', () => ({ registerWebFile: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it('migrates the upload rule once and validates edits before publishing them', async () => {
  vi.stubGlobal('__TAURI_INTERNALS__', {});
  invoke.mockImplementation(async (_command, { seed }) => ({
    path: 'C:\\settings\\image-host.jsonc',
    content: seed,
  }));
  useConfigStore.setState({
    imageDefaultDir: 'https://example.com/upload',
    imageUploadRule: '{\n  // Preserve this comment\n  "url": "https://example.com/upload"\n}',
  });
  const file = await loadSettingsDocument('imageHost');
  expect(file.content).toContain('// Preserve this comment');
  expect(getImageHostRule().url).toBe('https://example.com/upload');
  expect(useConfigStore.getState().imageUploadRule).toBe('');
  expect(() => prepareSettingsDocumentSave(file.path, '{"url":null')).toThrow();
  const publish = prepareSettingsDocumentSave(file.path, '{"url":"https://example.com/new"}');
  expect(getImageHostRule().url).toBe('https://example.com/upload');
  publish();
  expect(getImageHostRule().url).toBe('https://example.com/new');
});

it('moves language sources and custom manifests into a distinct file', async () => {
  vi.stubGlobal('__TAURI_INTERNALS__', {});
  invoke.mockImplementation(async (_command, { seed }) => ({
    path: 'C:\\settings\\language-plugins.jsonc',
    content: seed,
  }));
  const source = 'https://example.com/plugins.json';
  const manifest = {
    id: 'sample.server',
    name: 'Sample',
    languages: ['sample'],
    install: { kind: 'npm' },
  };
  useLspStore.setState({ sources: [source], catalog: [manifest] });
  const { content, path } = await loadSettingsDocument('languagePlugins');
  expect(JSON.parse(content)).toEqual({ sources: [source], manifests: [manifest] });
  expect(useLspStore.getState().externalConfigLoaded).toBe(true);
  expect(prepareSettingsDocumentSave(path, '{"sources":[],"manifests":[]}')).toBeTypeOf('function');
});

it('recognizes settings documents by path after restore or folder open', () => {
  expect(settingsDocumentKind('C:\\work\\editor-settings\\image-host.jsonc')).toBe('imageHost');
  expect(settingsDocumentKind('C:\\work\\editor-settings\\local-settings.jsonc')).toBe(
    'localSettings',
  );
  expect(settingsDocumentKind('C:\\work\\notes\\image-host.jsonc')).toBeUndefined();
});
