import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { getFolderIconUrl } from '@utils/folderIcons';
import { loadMaterialIcons } from '@utils/materialIcons';
import FileTypeIcon from './FileTypeIcon';

globalThis.React = React;

vi.mock('@utils/materialIcons', () => ({
  getMaterialIcons: () => ({
    FileIcon: ({ fileName, isFolder, isExpanded, size, className }) => (
      <svg data-file-name={fileName} data-is-folder={String(Boolean(isFolder))} data-is-expanded={String(Boolean(isExpanded))} width={size} className={className} />
    ),
    Tree: () => <svg data-tree-icon="true" />,
  }),
  loadMaterialIcons: vi.fn(),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('folder icon integration', () => {
  it('resolves distinct named icons and the upstream cloned assets', () => {
    const fallback = getFolderIconUrl('unrecognized-folder-name');
    expect(fallback).toBeNull();
    const urls = ['src', 'docs', 'images', 'node_modules', 'dev'].map((name) => getFolderIconUrl(name));
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) expect(url).not.toBe(fallback);
    expect(getFolderIconUrl('dev')).toContain('folder-development.clone.svg');
    expect(getFolderIconUrl('constructor')).toBe(fallback);
    expect(getFolderIconUrl('react')).toContain('folder-react-components.svg');
    expect(getFolderIconUrl('react-components')).toContain('folder-react-components.svg');
    expect(getFolderIconUrl('redux')).toContain('folder-redux-actions');
    expect(getFolderIconUrl('state')).toContain('folder-ngrx-state');
    expect(getFolderIconUrl('react', true)).toContain('folder-react-components-open.svg');
    expect(getFolderIconUrl('csharp')).toMatch(/folder-csharp|data:image\/svg/);
    expect(getFolderIconUrl('CSharp')).toBe(getFolderIconUrl('csharp'));
    expect(getFolderIconUrl('dotnet')).toBe(getFolderIconUrl('csharp'));
    expect(getFolderIconUrl('.mvn')).toMatch(/folder-mvn|data:image\/svg/);
    expect(getFolderIconUrl('mvn')).toBe(getFolderIconUrl('.mvn'));
    expect(getFolderIconUrl('maven')).toBe(getFolderIconUrl('.mvn'));
    expect(getFolderIconUrl('ngrx-actions')).toContain('folder-ngrx-actions');
    expect(getFolderIconUrl('vuex-store')).toContain('folder-vuex-store');
    expect(getFolderIconUrl('root')).toContain('folder-root');
  });

  it('handles case, hidden folders, paths, and expanded icons', () => {
    expect(getFolderIconUrl('C:\\project\\SRC\\')).toBe(getFolderIconUrl('src'));
    expect(getFolderIconUrl('/project/docs/')).toBe(getFolderIconUrl('docs'));
    expect(getFolderIconUrl('.github')).toBe(getFolderIconUrl('github'));
    expect(getFolderIconUrl('docs', true)).toContain('folder-docs-open.svg');
    expect(getFolderIconUrl('unrecognized-folder-name', true)).toBeNull();
  });

  it('updates mapped folder icons on rename and expansion', async () => {
    const { container, rerender } = render(<FileTypeIcon fileName="src" isFolder size={20} className="test-icon" />);
    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', getFolderIconUrl('src')));
    expect(container.querySelector('img')).toHaveAttribute('width', '20');
    expect(container.querySelector('img')).toHaveClass('test-icon');
    rerender(<FileTypeIcon fileName="docs" isFolder isExpanded />);
    expect(container.querySelector('img')).toHaveAttribute('src', getFolderIconUrl('docs', true));
    expect(loadMaterialIcons).not.toHaveBeenCalled();
  });

  it('uses the original folder icon when a name has no mapping, including after renaming', async () => {
    const { container, rerender } = render(<FileTypeIcon fileName="src" isFolder />);
    await waitFor(() => expect(container.querySelector('img')).toBeInTheDocument());
    rerender(<FileTypeIcon fileName="my-custom-folder" isFolder isExpanded size={20} className="test-icon" />);
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveAttribute('data-file-name', 'my-custom-folder');
    expect(container.querySelector('svg')).toHaveAttribute('data-is-folder', 'true');
    expect(container.querySelector('svg')).toHaveAttribute('data-is-expanded', 'true');
    expect(container.querySelector('svg')).toHaveAttribute('width', '20');
    expect(container.querySelector('svg')).toHaveClass('test-icon');
    rerender(<FileTypeIcon fileName="notes.mgtree" isFolder />);
    expect(container.querySelector('svg')).toHaveAttribute('data-is-folder', 'true');
    expect(container.querySelector('[data-tree-icon]')).not.toBeInTheDocument();
    rerender(<FileTypeIcon fileName="docs" isFolder />);
    expect(container.querySelector('img')).toHaveAttribute('src', getFolderIconUrl('docs'));
  });

  it('resolves files through the full official mapping', () => {
    const cases = [
      ['main.rs', /rust/],
      ['app.csproj', /visualstudio/],
      ['.gitignore', /git/],
      ['Dockerfile', /docker/],
      ['Makefile', /makefile/],
      ['README.md', /readme/],
      ['notes.md', /markdown/],
      ['DumpStack.log.tmp', /0097a7|tmp\.svg/],
      ['data.tmp', /0097a7|tmp\.svg/],
    ];
    for (const [fileName, pattern] of cases) {
      const { container } = render(<FileTypeIcon fileName={fileName} />);
      const img = container.querySelector('img');
      expect(img).toBeInTheDocument();
      expect(img.getAttribute('src')).toMatch(pattern);
      cleanup();
    }
  });

  it('falls back to the library for unknown files and keeps the tree icon', () => {
    const { container, rerender } = render(<FileTypeIcon fileName="blob.unknownxyz" />);
    expect(container.querySelector('svg')).toHaveAttribute('data-file-name', 'blob.unknownxyz');
    rerender(<FileTypeIcon fileName="notes.mgtree" />);
    expect(container.querySelector('svg')).toHaveAttribute('data-tree-icon', 'true');
  });
});
