import { useEffect, useState } from 'react';
import useFileStore from '@store/useFileStore';
import FileTree from './FileTree';
import ProjectExplorer from './ProjectExplorer';

export default function ExplorerModes() {
  const mode = useFileStore((state) => state.explorerMode);
  const [displayed, setDisplayed] = useState(mode);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (mode === displayed) { setLeaving(false); return undefined; }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setDisplayed(mode); return undefined; }
    setLeaving(true);
    const timer = setTimeout(() => { setDisplayed(mode); setLeaving(false); }, 100);
    return () => clearTimeout(timer);
  }, [mode, displayed]);
  return <div key={displayed} className={`explorer-mode explorer-mode--${displayed}${leaving ? ' explorer-mode--leaving' : ''}`}>
    {displayed === 'project' ? <ProjectExplorer /> : <FileTree />}
  </div>;
}
