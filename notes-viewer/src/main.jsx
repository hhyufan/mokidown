import React from 'react';
import { createRoot } from 'react-dom/client';
import { Tree, Tooltip } from 'antd';
import { CodeOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import Prism from 'prismjs';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-css';
import 'katex/dist/katex.min.css';
import '@components/editor/tree-editor.scss';

function InlineTitle({ title }) {
  return title.split(/(`[^`]+`)/g).map((part, index) => (part.startsWith('`') && part.endsWith('`')
    ? <code key={index}>{part.slice(1, -1)}</code> : part));
}

function NoteTree({ nodes, expandedKeys, onExpand, onSelect }) {
  const renderNode = (node, index, siblings, depth = 0) => ({
    key: node.key,
    data: node,
    className: [
      index === siblings.length - 1 ? 'moki-tree__last' : '',
      depth === 0 ? 'moki-tree__root' : '',
      depth === 0 && index === 0 ? 'moki-tree__root--first' : '',
      depth === 0 && index === siblings.length - 1 ? 'moki-tree__root--last' : '',
    ].filter(Boolean).join(' '),
    title: (
      <div className={`moki-tree__node${node.jump ? ' moki-tree__node--linked' : ''}`}>
        <span className="moki-tree__title"><InlineTitle title={node.title || ''} /></span>
        {node.jump && (
          <span className="moki-tree__reference" title={node.title}>
            <CodeOutlined className="moki-tree__icon" />
            {node.jump.language}<span>{node.jump.index}</span>
          </span>
        )}
      </div>
    ),
    children: (node.children || []).map((child, childIndex) => renderNode(child, childIndex, node.children, depth + 1)),
  });
  return <Tree treeData={nodes.map(renderNode)} expandedKeys={expandedKeys} onExpand={onExpand} onSelect={onSelect} blockNode showIcon={false} showLine={{ showLeafIcon: false }} />;
}

export function mountTree(el, nodes, expandedKeys, handlers) {
  if (!expandedKeys || !expandedKeys.length) {
    const auto = [];
    const collect = (items, depth) => {
      for (const node of items) {
        if (depth < 2 && node.children && node.children.length) auto.push(node.key);
        if (node.children && node.children.length) collect(node.children, depth + 1);
      }
    };
    collect(nodes, 0);
    expandedKeys = auto;
  }
  const root = createRoot(el);
  const render = (keys) => root.render(
    <NoteTree nodes={nodes} expandedKeys={keys} onExpand={(next) => handlers.onExpand(next)} onSelect={(_, info) => handlers.onSelect((info.node && info.node.data) || info.node)} />,
  );
  render(expandedKeys);
  return { update: render, unmount: () => root.unmount() };
}

const sanitizeSchema = { ...defaultSchema, attributes: { ...defaultSchema.attributes, code: [...(defaultSchema.attributes?.code || []), 'className'] } };

function Code({ className, children, inline }) {
  const lang = (className || '').match(/language-([\w-]+)/)?.[1];
  const text = String(children).replace(/\n$/, '');
  if (!inline && lang && Prism.languages[lang]) {
    return <code className={`language-${lang}`} dangerouslySetInnerHTML={{ __html: Prism.highlight(text, Prism.languages[lang], lang) }} />;
  }
  return <code className={className}>{children}</code>;
}

export function mountMarkdown(el, markdown) {
  const root = createRoot(el);
  root.render(
    <div className="md-preview">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeKatex, [rehypeSanitize, sanitizeSchema]]}
        components={{ code: Code }}
      >
        {markdown}
      </ReactMarkdown>
    </div>,
  );
  return { unmount: () => root.unmount() };
}
