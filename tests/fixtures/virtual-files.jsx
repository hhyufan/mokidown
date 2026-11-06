import React from 'react';
import { createRoot } from 'react-dom/client';
import VirtualFileList from '../../src/components/layout/sidebar/explorer/VirtualFileList';
import useFileStore from '../../src/store/useFileStore';
import { ensureDirectoryRange, getIndexedFile } from '../../src/services/workspaceFiles';

const parameters = new URLSearchParams(location.search);
const paged = parameters.has('paged');
const delay = Number(parameters.get('latency') || 40);
const metrics = { ranges: 0, publications: 0, active: 0, maxActive: 0, maxCachePages: 0, calls: [] };
window.virtualFileStress = metrics;
if (paged) {
  window.__TAURI_INTERNALS__ = {
    async invoke(command, args) {
      if (command !== 'read_directory_page') return;
      metrics.calls.push(args.offset);
      metrics.active += 1;
      metrics.maxActive = Math.max(metrics.maxActive, metrics.active);
      await new Promise((resolve) => setTimeout(resolve, delay));
      metrics.active -= 1;
      return Array.from({ length: Math.min(args.limit, 10_000_000 - args.offset) }, (_, index) => ({
        name: `note${args.offset + index}.md`, path: `/stress/note${args.offset + index}.md`,
      }));
    },
  };
  useFileStore.setState({ currentDir: '/stress', files: [], directoryIndex: {
    id: 'directory-1', total: 10_000_000, pageSize: 256, pages: new Map(),
  } });
  useFileStore.subscribe((state, previous) => {
    if (state.directoryIndex !== previous.directoryIndex && state.directoryIndex) {
      metrics.publications += 1;
      metrics.maxCachePages = Math.max(metrics.maxCachePages, state.directoryIndex.pages.size);
    }
  });
}

function onRangeChange(start, end, motion) {
  metrics.ranges += 1;
  if (paged) ensureDirectoryRange(start, end, motion);
}

function StressList() {
  const index = useFileStore((state) => state.directoryIndex);
  return <VirtualFileList
    count={10_000_000}
    dataVersion={paged ? index?.id : undefined}
    loadingLabel="Loading files…"
    onRangeChange={onRangeChange}
    renderRow={(position, style, { deferDetails }) => {
      const file = paged ? getIndexedFile(index, position) : { name: `note${position}.md` };
      return <div role="listitem" key={position} data-index={position} data-loaded={Boolean(file)} data-details={deferDetails ? 'deferred' : 'ready'} style={style}>
        {file?.name || '…'}
        {!deferDetails && file && <span data-rich-icon="true">◆</span>}
      </div>;
    }}
  />;
}

createRoot(document.getElementById('root')).render(
  <div style={{ display: 'flex', flexDirection: 'column', height: 640, width: 320 }}>
    <style>{'.file-tree__list { flex: 1; min-height: 0; overflow-y: auto; overflow-anchor: none; }'}</style>
    <StressList />
  </div>,
);
