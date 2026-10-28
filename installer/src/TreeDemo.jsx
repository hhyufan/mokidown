import { useEffect, useMemo, useRef, useState } from 'react';
import Prism from 'prismjs';
import { useTranslation } from 'react-i18next';
import { ConfigProvider } from 'antd';
import FileIcon from '../../src/components/ui/FileTypeIcon';
import KnowledgeTree from '../../src/components/editor/KnowledgeTree';
import { InlineTreeTitle } from '../../src/components/editor/TreeView';
import useDemoClock from './useDemoClock';
import useDemoComplete from './useDemoComplete';
import '../../src/components/editor/knowledge-tree.scss';
import '../../src/assets/styles/prism-theme.scss';

function CodeSample({ source }) {
  const tokens = useMemo(() => Prism.tokenize(source, Prism.languages.javascript), [source]);
  const render = (items) => items.map((token, index) => typeof token === 'string' ? token
    : <span key={index} className={['token', token.type, ...[].concat(token.alias || [])].join(' ')}>
      {Array.isArray(token.content) ? render(token.content) : token.content}
    </span>);
  return <pre className="language-javascript"><code className="language-javascript">{render(tokens)}</code></pre>;
}

export default function TreeDemo({ onComplete, loop = false }) {
  const { t } = useTranslation();
  const elapsed = useDemoClock(loop ? 14000 : 0);
  const [paused, setPaused] = useState(false);
  const [target, setTarget] = useState({ index: 0, revision: 0 });
  const [navWidth, setNavWidth] = useState(310);
  const layout = useRef(null);
  const navigation = useRef(null);
  const tabs = useRef(null);
  const preview = useRef(null);
  const automatic = useRef(false);
  const reduced = !Number.isFinite(elapsed);
  const step = reduced ? 0 : elapsed < 1400 ? 0 : elapsed < 4400 ? 1 : elapsed < 7400 ? 2 : 3;
  useDemoComplete(!paused && elapsed >= 11000, onComplete);
  const pause = () => setPaused(true);
  useEffect(() => {
    const list = tabs.current;
    const active = list.querySelector('.sidebar__tab--active');
    const slider = list.querySelector('.sidebar__tab-slider');
    const align = () => {
      // Layout coordinates stay correct inside the scaled installer scene.
      slider.style.width = `${active.offsetWidth}px`;
      slider.style.transform = `translateX(${active.offsetLeft - 5}px)`;
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(list);
    observer.observe(active);
    return () => observer.disconnect();
  }, []);
  const jumpTo = (_language, index) => {
    if (!automatic.current) pause();
    setTarget((value) => ({ index, revision: value.revision + 1 }));
  };
  // Activate the real sidebar buttons so node feedback matches the application.
  useEffect(() => {
    if (paused) return;
    if (!step) {
      setTarget({ index: 0, revision: 0 });
      preview.current?.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }
    const button = navigation.current?.querySelectorAll('.moki-tree__node--linked .moki-tree__title')[step - 1];
    automatic.current = true;
    button?.click();
    automatic.current = false;
  }, [step, paused]);
  useEffect(() => {
    if (!target.index) return;
    const container = preview.current;
    const block = container?.querySelector('[data-code-index="' + target.index + '"]');
    if (!block) return;
    container.scrollTo({ top: block.offsetTop - container.offsetTop - 48, behavior: reduced ? 'instant' : 'smooth' });
  }, [target, reduced]);
  const source = [t('installer.tree.root'),
    '  ' + t('installer.tree.prepare'),
    '  ' + t('installer.tree.runEdited') + ' >js[1]',
    '  ' + t('installer.tree.output') + ' >js++',
    t('installer.tree.reading'),
    '  ' + t('installer.tree.notes') + ' >js++'].join('\n');
  const samples = [
    { title: t('installer.tree.runEdited'), description: t('installer.tree.intro'), code: 'const message = "Hello Moki";\nconst notes = [];', result: 'Hello Moki' },
    { title: t('installer.tree.output'), description: t('installer.tree.outputHint'), code: 'console.log(message);\nconsole.log(notes.length);', result: 'Hello Moki\n0' },
    { title: t('installer.tree.notes'), description: t('installer.tree.notesHint'), code: 'notes.push({\n  title: message,\n  done: true\n});', result: '[{ title: "Hello Moki", done: true }]' },
  ];
  return <ConfigProvider theme={{ token: { fontFamily: 'var(--font-app)', colorPrimary: '#4091ff', fontSize: 12,
    colorBgElevated: '#fff', colorText: '#2c2c2e', borderRadius: 6 } }}>
    <div className="scene-tree-demo scene-surface scene-knowledge-workspace" data-step={step} data-complete={elapsed >= 11000}>
      <div className="tabbar scene-tabbar">
        <div className="tabbar__tab tabbar__tab--active"><FileIcon extension="md" size={16} />
          <span className="tabbar__tab-name">{t('installer.tree.filename')}.md</span>
        </div>
        <span className="scene-knowledge-phase">{t('installer.tree.phase.navigate')}</span>
      </div>
      <div className="scene-knowledge-layout" ref={layout} style={{ '--scene-nav-width': navWidth + 'px' }}>
        <aside className="scene-knowledge-nav" ref={navigation} onPointerDownCapture={pause} onKeyDownCapture={pause}>
          <div className="sidebar__tabs" ref={tabs}>
            <div className="sidebar__tab-slider" aria-hidden="true" />
            {['explorer', 'outline', 'knowledge', 'recent'].map((id) => <span key={id}
              className={'sidebar__tab ' + (id === 'knowledge' ? 'sidebar__tab--active' : '')}>
              {id === 'knowledge' && <span className="sidebar__knowledge-icon"><FileIcon extension="mgtree" size={12} /></span>}
              {id === 'knowledge' ? t('knowledgeTree.title') : t(id === 'explorer' ? 'sidebar.tab.explorer' : id === 'outline' ? 'sidebar.tab.outline' : 'sidebar.tab.recent')}
            </span>)}
          </div>
          <div className="knowledge-tree__list"><KnowledgeTree source={source} title={t('installer.tree.filename') + '.mgtree'} onJump={jumpTo} /></div>
        </aside>
        <div className="scene-knowledge-divider" role="separator" tabIndex={0} aria-orientation="vertical"
          aria-label={t('knowledgeTree.resizeSidebar')} aria-valuemin={240} aria-valuemax={380} aria-valuenow={navWidth}
          onPointerDown={(event) => { pause(); event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const box = layout.current.getBoundingClientRect();
            setNavWidth(Math.max(240, Math.min(380, (event.clientX - box.left) * layout.current.clientWidth / box.width)));
          }}
          onDoubleClick={() => { pause(); setNavWidth(310); }}
          onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            event.preventDefault(); pause(); setNavWidth((width) => Math.max(240, Math.min(380, width + (event.key === 'ArrowRight' ? 10 : -10))));
          }} />
        <div className="md-preview scene-knowledge-preview" ref={preview} onWheel={pause}>
          <h3>{t('installer.tree.root')}</h3><p>{t('installer.tree.previewHint')}</p>
          {samples.map((sample, index) => <section key={index} className="scene-knowledge-section">
            <h4>{index + 1}. <InlineTreeTitle title={sample.title} /></h4>
            <p>{sample.description}</p>
            <div data-code-index={index + 1} key={target.index === index + 1 ? target.revision : 0}
              className={'scene-knowledge-code ' + (target.index === index + 1 ? 'is-target' : '')}>
              <span className="scene-knowledge-code-label">javascript <span>{index + 1}</span></span>
              <CodeSample source={sample.code} />
            </div>
            <blockquote><pre>{sample.result}</pre></blockquote>
          </section>)}
        </div>
      </div>
      <div className="scene-editor-footer scene-knowledge-footer">{t('installer.tree.footer')}</div>
    </div>
  </ConfigProvider>;
}
