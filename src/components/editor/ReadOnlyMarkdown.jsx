import { createElement, lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import remarkMarkdownHtml from '@utils/remarkMarkdownHtml';
import { loadMarkdownImageSrc, resolveMarkdownLinkPath } from '@utils/markdownAssets';
import { invoke } from '@utils/tauriInvoke';
import { waitForReaderContent } from '@/services/readerContentReady';
import 'katex/dist/katex.min.css';
import './markdown-preview.scss';

const Mermaid = lazy(() => import('./MermaidRenderer'));
const remarkPlugins = [remarkGfm, remarkMath, remarkMarkdownHtml];
const schema = {
  ...defaultSchema,
  clobberPrefix: '',
  tagNames: [...defaultSchema.tagNames, 'mark', 'kbd', 'sub', 'sup', 'details', 'summary'],
  attributes: { ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes['*'] || []), 'className', 'id'],
    code: [...defaultSchema.attributes.code, 'className'],
  },
};
const rehypePlugins = [rehypeRaw, [rehypeSanitize, schema], rehypeKatex,
  [rehypeHighlight, { detect: false, ignoreMissing: true }]];

function heading(level) {
  const text = (node) => node?.value || node?.children?.map(text).join('') || '';
  return function Heading({ node, children, ...props }) {
    const id = text(node).toLowerCase().replace(/[^\w\u4e00-\u9fff\s-]/g, '').trim().replace(/\s+/g, '-');
    return createElement(`h${level}`, { ...props, id }, children);
  };
}

function Image({ src, alt, documentPath, node: _node, ...props }) {
  const [resolved, setResolved] = useState(src);
  const [pending, setPending] = useState(true);
  useEffect(() => {
    let cancelled = false;
    let objectUrl;
    setPending(true);
    setResolved(src);
    loadMarkdownImageSrc(src, documentPath).then((result) => {
      if (cancelled) { if (result.objectUrl) URL.revokeObjectURL(result.objectUrl); return; }
      objectUrl = result.objectUrl;
      setResolved(result.src || src);
    }).catch(() => {}).finally(() => { if (!cancelled) setPending(false); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [src, documentPath]);
  return <img {...props} src={resolved} alt={alt || ''} loading="lazy" data-reader-pending={pending ? '' : undefined} />;
}

function ReaderMermaid({ code, dark, eager }) {
  const [pending, setPending] = useState(true);
  return <div data-reader-pending={pending ? '' : undefined}>
    <Suspense fallback={<code>{code}</code>}>
      <Mermaid code={code} isDark={dark} eager={eager} onRendered={() => setPending(false)} />
    </Suspense>
  </div>;
}

// This renderer intentionally has no editor store, execution controls or editable node views.
const ReadOnlyMarkdown = memo(function ReadOnlyMarkdown({ content, documentPath, dark, fontSize, lineHeight, onReady }) {
  const root = useRef(null);
  useEffect(() => {
    if (!onReady) return undefined;
    const controller = new AbortController();
    void waitForReaderContent(root.current, controller.signal).then(() => {
      if (!controller.signal.aborted) onReady();
    }).catch((error) => {
      if (!controller.signal.aborted) { console.error('[reader] Content readiness failed:', error); onReady(); }
    });
    return () => controller.abort();
  }, [content, documentPath, dark, onReady]);
  const components = useMemo(() => ({
    h1: heading(1), h2: heading(2), h3: heading(3), h4: heading(4), h5: heading(5), h6: heading(6),
    code: ({ className, children, node: _node, ...props }) => {
      if (className?.includes('language-mermaid')) {
        return <ReaderMermaid code={String(children).trimEnd()} dark={dark} eager={Boolean(onReady)} />;
      }
      return <code className={className} {...props}>{children}</code>;
    },
    img: (props) => <Image {...props} documentPath={documentPath} />,
    input: ({ node: _node, ...props }) => <input {...props} disabled readOnly />,
    table: ({ children, node: _node, ...props }) => <div className="md-preview__table-wrap"><table {...props}>{children}</table></div>,
    a: ({ href, children, node: _node, ...props }) => <a {...props} href={href} onClick={(event) => {
      if (href?.startsWith('#')) {
        event.preventDefault();
        let fragment = href.slice(1);
        try { fragment = decodeURIComponent(fragment); } catch { /* Preserve malformed fragments as literal IDs. */ }
        root.current?.querySelector(`#${CSS.escape(fragment)}`)?.scrollIntoView({ block: 'center' });
      } else if (window.__TAURI_INTERNALS__) {
        event.preventDefault();
        const target = resolveMarkdownLinkPath(href, documentPath);
        const action = target.internal && target.path
          ? invoke('open_reader_window', { document: { id: target.path, name: target.path.split(/[\\/]/).pop(), path: target.path }, x: null, y: null })
          : invoke('open_external', { url: href });
        void action.catch((error) => console.error('[reader] Could not open link:', error));
      }
    }} target={href?.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer">{children}</a>,
  }), [documentPath, dark, onReady]);
  return <article ref={root} className="md-preview reader__document" style={{ fontSize, lineHeight: lineHeight / fontSize }}>
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>{content}</ReactMarkdown>
  </article>;
});

export default ReadOnlyMarkdown;
