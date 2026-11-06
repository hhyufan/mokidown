import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/i18n';
import ExplorerModes from '../../src/components/layout/sidebar/explorer/ExplorerModes';
import useFileStore from '../../src/store/useFileStore';
import useEditorStore from '../../src/store/useEditorStore';
import { useFileManager } from '../../src/hooks/useFileManager';
import '../../src/components/layout/sidebar/sidebar.scss';

const base = '/workspace/demo';
const far = new URLSearchParams(location.search).has('far');
const features = new URLSearchParams(location.search).has('features');
const entry = (parent, name, is_dir = false) => ({ name, path: `${parent}/${name}`, is_dir, is_file: !is_dir });
const folders = features ? ['src', 'csharp', 'docs', 'empty', 'denied'] : ['src', 'csharp', 'docs'];
const longName = `${'long-filename-'.repeat(18)}NeedleTail.md`;
const createdFiles = new Map(), writes = [];
function baseCount(path) { return path.endsWith('/empty') ? 0 : features && path === `${base}/src` ? 5 : path === base ? 9000 : path === '/workspace' ? far ? 5001 : 2 : path === '/' ? 1 : 3; }
function count(path) { return baseCount(path) + (createdFiles.get(path)?.length || 0); }
function row(path, index) {
  if (index >= baseCount(path)) return entry(path, createdFiles.get(path)[index - baseCount(path)]);
  if (path === base) return index < folders.length ? entry(path, folders[index], true) : entry(path, features && index === folders.length ? `${'wide-root-'.repeat(18)}.md` : `note${index}.md`);
  if (path === '/workspace') return entry(path, index === (far ? 4999 : 0) ? 'demo' : `other${index}`, true);
  if (path === '/') return entry('', 'workspace', true);
  if (features && path === `${base}/src`) return entry(path, ['nested', 'empty', 'denied', 'README.md', 'readme.txt'][index], index < 3);
  if (features && path.endsWith('/nested') && index === 0) return entry(path, longName);
  return entry(path, ['App.tsx', 'README.md', 'readme.txt'][index]);
}
const snapshots = new Map([['fixture-root', base]]);
window.__TAURI_INTERNALS__ = {
  async invoke(command, args) {
    if (command === 'open_directory_index') {
      if (args.dirPath.endsWith('/denied')) throw new Error('Access denied');
      snapshots.set(args.id, args.dirPath);
      return { id: args.id, total: count(args.dirPath), pageSize: 256 };
    }
    if (command === 'read_directory_page') {
      const path = snapshots.get(args.id);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return Array.from({ length: Math.min(args.limit, count(path) - args.offset) }, (_, index) => {
        const file = row(path, args.offset + index);
        return file.is_dir ? { ...file, directoryState: file.name === 'empty' ? 'empty' : file.name === 'denied' ? 'unreadable' : 'readable', directoryError: file.name === 'denied' ? 'Access denied' : undefined } : file;
      });
    }
    if (command === 'locate_directory_entry') {
      const path = snapshots.get(args.id);
      for (let index = 0; index < count(path); index++) if (row(path, index).path === args.path) return index;
      return null;
    }
    if (command === 'search_files') {
      const results = [];
      const paths = args.options.recursive ? [args.dirPath, `${args.dirPath}/src`, `${args.dirPath}/docs`, `${args.dirPath}/csharp`] : [args.dirPath];
      if (features && args.options.recursive) paths.push(`${args.dirPath}/src/nested`);
      const normalize = (text) => args.options.caseSensitive ? text : text.toLowerCase();
      for (const path of paths) for (let index = 0; index < count(path); index++) {
        const item = row(path, index);
        if (normalize(item.name).includes(normalize(args.query))) results.push(item);
      }
      return { results: results.slice(0, 1000), truncated: results.length > 1000, skippedFiles: 0 };
    }
    if (command === 'close_directory_index') snapshots.delete(args.id);
    if (command === 'check_file_exists') return writes.includes(args.path);
    if (command === 'write_file_content') {
      if (window.projectFixture?.denyWrites) throw new Error('Access denied');
      writes.push(args.path);
      const boundary = args.path.lastIndexOf('/'), parent = args.path.slice(0, boundary);
      createdFiles.set(parent, [...(createdFiles.get(parent) || []), args.path.slice(boundary + 1)]);
    }
    if (command === 'read_file_content') return { success: true, content: '', encoding: 'UTF-8' };
    if (command === 'get_file_info') return { size: 0 };
    return null;
  },
};
useFileStore.setState({ currentDir: base, explorerMode: 'project', directoryLoading: false, directoryIndex: {
  id: 'fixture-root', path: base, pageSize: 256, total: count(base), pages: new Map(),
}, files: [], dirHistory: [base], historyIndex: 0 });
window.projectFixture = { useFileStore, useEditorStore, writes, longName };

function Fixture() {
  const mode = useFileStore((state) => state.explorerMode);
  const collapsed = useFileStore((state) => state.projectRootCollapsed);
  const { createFileWithDialog } = useFileManager();
  return <div className="sidebar__view" style={{ height: 650, width: 300, background: 'var(--sidebar)' }}>
    <style>{`:root{--text:#dce4ee;--text-sec:#9faab9;--text-dim:#8b96a5;--sidebar:#202227;--hover:#2d323b;--accent:#78b2ff;--accent-light:#314b6b;--border:#3b414b;--border-light:#333842;--radius-sm:4px;--error:#f66}body{margin:24px;background:#14161a;font-family:Arial} .explorer-mode{overflow:hidden}`}</style>
    <button onClick={() => useFileStore.getState().setExplorerMode(mode === 'project' ? 'files' : 'project')}>Toggle mode</button>
    <button disabled={mode === 'project' && collapsed} onClick={createFileWithDialog}>New file</button>
    <ExplorerModes />
  </div>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
