import React, { useEffect, useState } from 'react';
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
import TreeView, { InlineTreeTitle, TreeNodeRow } from '@components/editor/TreeView';
import '@components/editor/tree-editor.scss';

function InlineTitle({ title }) {
  return title.split(/(`[^`]+`)/g).map((part, index) => (part.startsWith('`') && part.endsWith('`')
    ? <code key={index}>{part.slice(1, -1)}</code> : part));
}

function NoteTree({ nodes, initialKeys, onExpand, onSelect }) {
  const [expandedKeys, setExpandedKeys] = useState(initialKeys);
  const [jumpingKey, setJumpingKey] = useState(null);
  useEffect(() => {
    if (!jumpingKey) return undefined;
    const timer = setTimeout(() => setJumpingKey(null), 4000);
    return () => clearTimeout(timer);
  }, [jumpingKey]);
  const converted = (items) => items.map((node) => ({
    key: node.key,
    title: node.title,
    jumpLanguage: node.jump ? node.jump.language : null,
    jumpIndex: node.jump ? node.jump.index : null,
    originalText: node.title,
    children: converted(node.children || []),
  }));
  const renderTitle = (node) => (
    <TreeNodeRow node={node} highlighted={jumpingKey === node.key}>
      <span className="moki-tree__title"><InlineTreeTitle title={node.title} /></span>
    </TreeNodeRow>
  );
  return <TreeView nodes={converted(nodes)} expandedKeys={expandedKeys}
    onExpand={(keys) => { setExpandedKeys(keys); onExpand(keys); }}
    renderTitle={renderTitle}
    onSelect={(_, info) => {
      const target = info && info.node && info.node.treeNode;
      if (!target) return;
      setJumpingKey(target.key);
      onSelect(target);
    }} />;
}

function autoKeys(nodes) {
  const keys = [];
  const walk = (items, depth) => {
    for (const node of items) {
      if (depth < 2 && node.children && node.children.length) keys.push(node.key);
      if (node.children && node.children.length) walk(node.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return keys;
}

export function mountTree(el, nodes, expandedKeys, handlers) {
  const root = createRoot(el);
  const initial = expandedKeys && expandedKeys.length ? expandedKeys : autoKeys(nodes);
  root.render(<NoteTree nodes={nodes} initialKeys={initial} onExpand={(keys) => handlers.onExpand(keys)} onSelect={handlers.onSelect} />);
  return { unmount: () => root.unmount() };
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
