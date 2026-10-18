import { useEffect, useRef, useState } from 'react';
import { ConfigProvider, theme as antdTheme } from 'antd';
import FeatureScenes from '../../installer/src/FeatureScenes';

const scenes = [
  {
    label: 'WYSIWYG',
    title: (
      <>
        写下这一刻，
        <br />
        <em>即刻成为好文章。</em>
      </>
    ),
    description: '输入 Markdown，文字自然成形。标题、强调与引用，就在笔下呈现。',
  },
  {
    label: 'WRITE',
    title: (
      <>
        落笔即所见，
        <br />
        <em>专注每个想法。</em>
      </>
    ),
    description: 'Markdown 源码与实时预览并肩呈现，从第一行文字到完整的创作。',
  },
  {
    label: 'LANGUAGE',
    title: (
      <>
        写作的细节，
        <br />
        <em>也有贴心的帮手。</em>
      </>
    ),
    description: 'Markdown 语言服务辅助链接补全与检查，让文档之间的连接更顺畅。',
  },
  {
    label: 'PERSONALIZE',
    title: (
      <>
        白昼或深夜，
        <br />
        <em>都恰好合心意。</em>
      </>
    ),
    description: '浅深主题、背景与编辑布局，让写作空间成为你喜欢的模样。',
  },
  {
    label: 'ORGANIZE',
    title: (
      <>
        让零散灵感，
        <br />
        <em>慢慢连成体系。</em>
      </>
    ),
    description: '用文档树与知识树整理笔记，让每个想法都有迹可循。',
  },
];

function FeatureBlock({ index, scene, active }) {
  return (
    <article
      className={`feature-block${index % 2 === 1 ? ' feature-block--flip' : ''}${active ? ' is-inview' : ''}`}
      data-moki-feature-block={index}
    >
      <div className="feature-block__inner">
        <div className="feature-block__copy">
          <span className="feature-block__eyebrow">
            0{index + 1} / {scene.label}
          </span>
          <h2>{scene.title}</h2>
          <p>{scene.description}</p>
        </div>
        <div className="feature-block__stage">
          <div className="feature-block__frame">
            <FeatureScenes slide={index} active={active} />
          </div>
        </div>
      </div>
    </article>
  );
}

export default function FeatureSections() {
  const [active, setActive] = useState(() => new Set());
  const [isDark, setIsDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark',
  );
  const blocks = useRef([]);
  const [atDemo, setAtDemo] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const demo = document.getElementById('demo');
      setAtDemo(Boolean(demo && demo.getBoundingClientRect().top < window.innerHeight * 0.4));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setIsDark(root.dataset.theme === 'dark');
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        setActive((current) => {
          const next = new Set(current);
          for (const entry of entries) {
            const index = Number(entry.target.dataset.index);
            // Play only while the screen is on view: entering starts it,
            // leaving stops and unmounts it again.
            if (entry.isIntersecting) next.add(index);
            else next.delete(index);
          }
          return next;
        });
      },
      { rootMargin: '-10% 0px -25% 0px', threshold: 0 },
    );
    for (const block of blocks.current) {
      if (block) observer.observe(block);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <ConfigProvider theme={{ algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm }}>
    <div className="feature-sections">
      {scenes.map((scene, index) => (
        <div
          key={scene.label}
          ref={(node) => {
            blocks.current[index] = node;
          }}
          data-index={index}
          className="feature-block-host"
        >
          <FeatureBlock index={index} scene={scene} active={active.has(index)} />
        </div>
      ))}
    </div>
    {!atDemo ? (
      <button
        className="pager-next"
        type="button"
        onClick={() => {
          const hosts = [...document.querySelectorAll('.feature-block-host')];
          const current = hosts.findIndex((host) => host.getBoundingClientRect().top > -window.innerHeight * 0.25);
          const next = hosts[Math.max(0, current) + 1] ?? document.getElementById('demo');
          next?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
      >
        <span>继续了解 MokiDown</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
      </button>
    ) : null}
    </ConfigProvider>
  );
}
