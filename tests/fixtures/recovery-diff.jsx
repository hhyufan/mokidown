import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as monaco from 'monaco-editor';
import '../../src/i18n';
import RecoveryModal from '../../src/components/overlays/RecoveryModal';
import useThemeStore from '../../src/store/useThemeStore';
import '../../src/assets/styles/background-surfaces.scss';

const drafts = [
  { recoveryId: 'code', name: 'main.ts', path: '/project/main.ts', diskState: 'changed', diskContent: 'export const count = 1;\n', content: `export const count = 2;\n${'// recovered content\n'.repeat(35)}// complete draft ending` },
  { recoveryId: 'new', name: 'untitled.md', path: '', content: '# Unsaved new document\n' },
  { recoveryId: 'missing', name: 'missing.txt', path: '/project/missing.txt', diskState: 'missing', content: 'Recovered missing file\n' },
];
const options = new URLSearchParams(location.search);
if (options.has('glass')) {
  const common = Array.from({ length: 70 }, (_, index) => `// same line ${index}\n`).join('');
  drafts[0].diskContent = `export const count = 1;\n${common}`;
  drafts[0].content = `export const count = 2;\n${common}// complete draft ending`;
  document.body.classList.add('moki-has-background');
}
if (options.has('many')) {
  drafts.push(...Array.from({ length: 60 }, (_, index) => ({ recoveryId: `extra-${index}`, name: `draft-${index}.txt`,
    path: `/project/${'long-folder/'.repeat(12)}draft-${index}.txt`, diskState: 'missing', content: `draft ${index}` })));
}
window.recoveryFixture = { monaco, restored: [], discarded: false };

function Fixture() {
  const [open, setOpen] = useState(true);
  return <>
    <style>{`:root { --text:#273142;--text-sec:#647083;--surface:#fff;--bg:#f6f8fb;--border:#dde3ed;--border-light:#e7ebf2;--accent:#398cff;--accent-light:#e8f0ff;--radius-sm:4px;--font-app:Arial } body{font-family:Arial;margin:0;background:#edf0f5}`}</style>
    <button onClick={() => useThemeStore.getState().toggleTheme()}>Switch theme</button>
    <RecoveryModal open={open} drafts={drafts} onRestore={(chosen) => { window.recoveryFixture.restored = chosen.map((draft) => draft.recoveryId); setOpen(false); }} onDiscard={() => { window.recoveryFixture.discarded = true; setOpen(false); }} />
  </>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
