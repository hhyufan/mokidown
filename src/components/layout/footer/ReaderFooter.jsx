import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { getDirectoryContents, isSafUri, safDisplayName } from '@utils/tauriApi';
import { splitPath, buildFullPath } from '@utils/pathUtils';
import FileTypeIcon from '@components/ui/FileTypeIcon';
import TaskStatusIndicator from '@components/ui/TaskStatusIndicator';
import { useRuntimeLogStore } from '@/services/runtimeLogs';
import useUpdateStore from '@store/useUpdateStore';
import useTasks from '@hooks/useTasks';
import './footer.scss';

/** Single-document footer, with no dependency on the main editor's tab store. */
export default function ReaderFooter({ document: info, content, position, onOpenFile }) {
  const { t } = useTranslation();
  const logCount = useRuntimeLogStore((state) => state.entries.length);
  const tasksOpen = useUpdateStore((state) => state.open);
  const { active: activeTask } = useTasks();
  const footer = useRef(null);
  const popup = useRef(null);
  const scroll = useRef(null);
  const request = useRef(0);
  const [menu, setMenu] = useState(null);
  const [error, setError] = useState('');
  const segments = useMemo(() => isSafUri(info.path)
    ? [safDisplayName(info.path)] : splitPath(info.path), [info.path]);
  const fullPath = (index) => {
    // Keep drive/root prefixes, including Windows paths delivered with forward slashes.
    const built = buildFullPath(segments, index);
    if (/^[a-z]:\//i.test(info.path)) return index === 0 ? `${built.slice(1)}/` : built.slice(1);
    if (info.path.startsWith('\\\\')) return `\\\\${built.slice(1).replaceAll('/', '\\')}`;
    return built;
  };
  const closeMenu = () => { request.current += 1; setMenu(null); };

  useEffect(() => {
    const element = scroll.current;
    if (!element) return undefined;
    element.scrollLeft = element.scrollWidth;
    const wheel = (event) => {
      if (event.ctrlKey || event.metaKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      element.scrollLeft += event.deltaY;
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [info.path]);

  useEffect(() => {
    if (!menu) return undefined;
    const dismiss = (event) => {
      if (!footer.current?.contains(event.target) && !popup.current?.contains(event.target)) {
        request.current += 1;
        setMenu(null);
      }
    };
    const keydown = (event) => {
      if (event.key === 'Escape') {
        request.current += 1;
        setMenu(null);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', keydown);
    };
  }, [menu]);

  useEffect(() => () => { request.current += 1; }, []);

  const browse = async (path, index, rect) => {
    const revision = ++request.current;
    setError('');
    setMenu({ path, index, rect, items: null });
    try {
      const items = await getDirectoryContents(path);
      if (revision !== request.current) return;
      const sorted = [...(Array.isArray(items) ? items : [])].sort((a, b) =>
        Number(b.is_dir) - Number(a.is_dir) || a.name.localeCompare(b.name));
      setMenu({ path, index, rect, items: sorted });
    } catch (failure) {
      if (revision !== request.current) return;
      setMenu(null);
      setError(failure.message || String(failure));
    }
  };
  const choose = async (item) => {
    if (item.is_dir) { await browse(item.path, menu.index, menu.rect); return; }
    closeMenu();
    try { await onOpenFile(item); }
    catch (failure) { setError(failure.message || String(failure)); }
  };
  const lineEnding = info.lineEnding || (content.includes('\r\n') ? 'CRLF' : content.includes('\r') ? 'CR' : 'LF');

  return <>
    {error && <div className="reader__message" role="alert">{error}</div>}
    <footer ref={footer} className="footer reader__footer">
      <nav className="footer__breadcrumb" aria-label={info.path || info.name}>
        {segments.length ? <div ref={scroll} className="footer__breadcrumb-path">
          {segments.map((segment, index) => <span key={index} className="footer__breadcrumb-item">
            {index > 0 && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>}
            <button type="button" className="footer__breadcrumb-segment"
              aria-label={fullPath(index)} aria-haspopup={index < segments.length - 1 ? 'menu' : undefined}
              aria-expanded={index < segments.length - 1 ? menu?.index === index : undefined}
              onClick={(event) => {
                if (isSafUri(info.path) || index === segments.length - 1) return;
                if (menu?.index === index) { closeMenu(); return; }
                const rect = event.currentTarget.getBoundingClientRect();
                void browse(fullPath(index), index, { left: rect.left, top: rect.top });
              }}>
              {/^[a-z]:\\$/i.test(segment) ? segment.slice(0, 2) : segment}
            </button>
          </span>)}
        </div> : <span>{info.name}</span>}
      </nav>
      <div className="footer__right">
        {(logCount > 0 || activeTask) && <TaskStatusIndicator stage={activeTask?.stage}
          progress={activeTask?.percent} leaving={activeTask?.leaving}
          label={activeTask ? `${activeTask.status}${Number.isFinite(activeTask.percent) ? ` ${activeTask.percent}%` : ''}` : t('tasks.title')} expanded={tasksOpen}
          onClick={() => tasksOpen ? useUpdateStore.getState().dismiss() : useUpdateStore.getState().showTasks()} />}
        <span>{t('footer.line')} {position.lineNumber}, {t('footer.column')} {position.column}</span>
        <span className="footer__sep" />
        <span>{content.length} {t('footer.chars')}</span>
        <span className="footer__sep" />
        <span>{info.encoding || 'UTF-8'}</span>
        <span className="footer__sep" />
        <span>{lineEnding}</span>
      </div>
    </footer>
    {menu?.items && createPortal(<div ref={popup} className="footer__dropdown reader__directory-menu" role="menu"
      style={{ left: Math.max(8, Math.min(menu.rect.left, window.innerWidth - 288)),
        bottom: Math.max(8, window.innerHeight - menu.rect.top + 6) }}>
      {menu.items.length === 0 ? <div className="footer__dropdown-empty">{t('footer.emptyDir')}</div>
          : menu.items.map((item) => <button key={item.path} type="button" role="menuitem"
            className="footer__dropdown-item" onClick={() => void choose(item)}>
            <span className="footer__dropdown-icon"><FileTypeIcon fileName={item.name} isFolder={item.is_dir} /></span>
            <span className="footer__dropdown-name">{item.name}</span>
          </button>)}
    </div>, document.body)}
  </>;
}
