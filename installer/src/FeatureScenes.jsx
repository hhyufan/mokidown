import i18n from '../../src/i18n';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import LanguageDemo from './LanguageDemo';
import SplitDemo from './SplitDemo';
import ThemeDemo from './ThemeDemo';

import remarkGfm from 'remark-gfm';
import FileIcon from '../../src/components/ui/FileTypeIcon';
import '../../src/components/editor/markdown-preview.scss';
import '../../src/components/layout/sidebar/explorer/file-tree.scss';
import '../../src/components/layout/tab-bar/tabbar.scss';
import '../../src/components/layout/sidebar/sidebar.scss';
import '../../src/components/editor/tree-editor.scss';
import './feature-scenes.css';

const TreeDemo = lazy(() => import('./TreeDemo'));
const WritingDemo = lazy(() => import('./WritingDemo'));

const markdown =
  '# 写下新的想法\n\n从一行文字，开始新的创作。\n\n> 好的想法，值得被认真记录。\n\n- [x] 记录今天的灵感\n- [ ] 写下新的故事';

function DocumentPreview({ compact = false }) {
  return (
    <div className={`md-preview scene-markdown${compact ? ' scene-markdown--compact' : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </div>
  );
}

function PanelHeader({ name, extension = 'md' }) {
  return (
    <div className="tabbar scene-tabbar">
      <div className="tabbar__tabs">
        <div className="tabbar__tab tabbar__tab--active">
          <span className="tabbar__tab-icon">
            <FileIcon extension={extension} size={16} />
          </span>
          <span className="tabbar__tab-name">{name}</span>
          <span className="tabbar__tab-close">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </span>
        </div>
      </div>
      <span className="scene-layout-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M12 3v18" />
        </svg>
      </span>
    </div>
  );
}

export default function FeatureScenes({ slide, active, onComplete, loop = false }) {
  const [retained, setRetained] = useState(active);
  const activeRef = useRef(active);
  activeRef.current = active;
  const present = active || retained;
  useEffect(() => {
    if (active) {
      setRetained(true);
      return undefined;
    }
    const timer = setTimeout(() => setRetained(false), 480);
    return () => clearTimeout(timer);
  }, [active]);
  const complete = useCallback(() => {
    if (activeRef.current) onComplete?.(slide);
  }, [slide, onComplete]);
  if (slide === 0)
    return (
      <div className="feature-scene scene-wysiwyg" aria-label={i18n.t('installer.richTextDemo')}>
        <div className="scene-surface scene-editor-card">
          <PanelHeader name="灵感随笔.md" />
          <div className="scene-demo-body">
            {present && (
              <Suspense fallback={<div className="scene-demo-loading" />}>
                <WritingDemo onComplete={complete} />
              </Suspense>
            )}
          </div>
          <div className="scene-editor-footer">
            <span>{i18n.t('installer.richText')}</span>
            <span>Markdown</span>
          </div>
        </div>
      </div>
    );
  if (slide === 2)
    return (
      <div className="feature-scene scene-language" aria-label={i18n.t('installer.languageDemo')}>
        <div className="scene-surface scene-editor-card">
          <PanelHeader name="阅读清单.md" />
          {present && <LanguageDemo onComplete={complete} />}
        </div>
      </div>
    );
  if (slide === 3)
    return (
      <div className="feature-scene scene-themes" aria-label={i18n.t('installer.themesDemo')}>
        {present && (
          <ThemeDemo onComplete={complete}>
            <PanelHeader name="开始创作.md" />
            <DocumentPreview compact />
          </ThemeDemo>
        )}
      </div>
    );
  if (slide === 4)
    return (
      <div className="feature-scene scene-organize" aria-label={i18n.t('installer.organizeDemo')}>
        {present && <Suspense fallback={null}><TreeDemo onComplete={complete} loop={loop} /></Suspense>}
      </div>
    );
  return (
    <div className="feature-scene scene-write" aria-label={i18n.t('installer.splitDemo')}>
      <div className="scene-surface scene-editor-card">
        <PanelHeader name="开始创作.md" />
        {present && <SplitDemo onComplete={complete} />}
        <div className="scene-editor-footer">
          <span>Markdown</span>
          <span>UTF-8 &nbsp; · &nbsp; LF</span>
        </div>
      </div>
    </div>
  );
}
