import { memo, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import Prism from '@utils/prismGlobal';
import remarkMarkdownHtml from '@utils/remarkMarkdownHtml';
import 'katex/dist/katex.min.css';
import {
  ALLOWED_IMAGE_PROTOCOLS,
  loadMarkdownImageSrc,
  markdownUrlTransform,
  rehypeNormalizeImageSrc,
} from '@utils/markdownAssets';

const SNAPSHOT_SANITIZE_SCHEMA = {
  ...defaultSchema,
  clobberPrefix: '',
  clobber: [],
  protocols: {
    ...defaultSchema.protocols,
    src: ALLOWED_IMAGE_PROTOCOLS,
  },
  tagNames: [
    ...(defaultSchema.tagNames || []),
    'span',
    'div',
    'sup',
    'sub',
    'ins',
    'del',
    'mark',
    'kbd',
    'section',
    'details',
    'summary',
    'figure',
    'figcaption',
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] || []), 'className', 'class', 'id', 'style'],
    code: [...(defaultSchema.attributes?.code || []), 'className', 'class'],
    img: [...(defaultSchema.attributes?.img || []), 'src', 'alt', 'title', 'width', 'height'],
    input: ['type', 'checked', 'disabled', 'className', 'class'],
  },
};

const SNAPSHOT_REMARK_PLUGINS = [remarkGfm, remarkMath, remarkMarkdownHtml];
const snapshotStyleProperties = [
  'background-color',
  'color',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'text-align',
  'text-decoration-line',
  'text-decoration-color',
  'white-space',
  'line-height',
  'border-color',
  'border-style',
  'border-width',
  'border-radius',
  'margin',
  'padding',
  'width',
  'max-width',
  'min-width',
  'height',
  'min-height',
  'display',
  'gap',
  'align-items',
  'justify-content',
  'flex-direction',
  'flex-wrap',
  'grid-template-columns',
  'grid-template-rows',
  'list-style-type',
];

function rehypeSnapshotStyles() {
  return (tree) => {
    let style;
    const visit = (node) => {
      if (typeof node.properties?.style === 'string') {
        style ||= document.createElement('span').style;
        style.cssText = node.properties.style;
        node.properties.style = snapshotStyleProperties
          .flatMap((property) => {
            const value = style.getPropertyValue(property);
            return value ? [`${property}: ${value}`] : [];
          })
          .join('; ');
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

function remarkSnapshotSelection({ html }) {
  return (tree) => {
    tree.children = [{ type: 'html', value: html }];
  };
}

const SNAPSHOT_REHYPE_PLUGINS = [
  rehypeRaw,
  rehypeNormalizeImageSrc,
  rehypeSnapshotStyles,
  [rehypeSanitize, SNAPSHOT_SANITIZE_SCHEMA],
  rehypeKatex,
];

function SnapshotMarkdownImage({ src, alt, documentPath, ...props }) {
  const [resolved, setResolved] = useState(src);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;
    setResolved(src);
    loadMarkdownImageSrc(src, documentPath).then((result) => {
      if (cancelled) {
        if (result.objectUrl) URL.revokeObjectURL(result.objectUrl);
        return;
      }
      objectUrl = result.objectUrl;
      setResolved(result.src || src);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, documentPath]);

  return <img src={resolved} alt={alt || ''} {...props} />;
}

const SnapshotMarkdownBody = memo(function SnapshotMarkdownBody({
  content,
  selectionHtml,
  dark,
  documentPath,
  contentRef,
}) {
  const components = useMemo(
    () => ({
      img: ({ src, alt, node: _node, ...props }) => (
        <SnapshotMarkdownImage src={src} alt={alt} documentPath={documentPath} {...props} />
      ),
      input: ({ type, checked, node: _node, ...props }) =>
        type === 'checkbox' ? (
          <input type="checkbox" checked={Boolean(checked)} readOnly disabled {...props} />
        ) : (
          <input type={type} {...props} />
        ),
    }),
    [documentPath],
  );
  const remarkPlugins = useMemo(
    () =>
      selectionHtml
        ? [[remarkSnapshotSelection, { html: selectionHtml }]]
        : SNAPSHOT_REMARK_PLUGINS,
    [selectionHtml],
  );

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    el.querySelectorAll('pre > code[class*="language-"]').forEach((codeEl) => {
      try {
        Prism.highlightElement(codeEl);
      } catch {
        /* Fallback to plain code when a Prism grammar is unavailable. */
      }
    });
  }, [content, selectionHtml, contentRef]);

  return (
    <div
      ref={contentRef}
      className="snapshot-card__markdown"
      data-snapshot-theme={dark ? 'dark' : 'light'}
      onClick={(event) => {
        if (event.target.closest('a[href]')) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (event.target.closest('a[href]')) event.preventDefault();
      }}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={SNAPSHOT_REHYPE_PLUGINS}
        urlTransform={markdownUrlTransform}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

export default SnapshotMarkdownBody;
