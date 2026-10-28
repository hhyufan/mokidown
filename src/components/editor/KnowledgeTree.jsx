import { Tooltip } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { flattenTree, parseTreeText } from '@utils/mgtree';
import TreeView, { InlineTreeTitle, TreeNodeRow, TreeControls } from './TreeView';
import './knowledge-tree.scss';

export default function KnowledgeTree({ source, onJump, onOpen, title }) {
  const { t } = useTranslation();
  const nodes = useMemo(() => parseTreeText(source), [source]);
  const [expanded, setExpanded] = useState(null);
  const [jumping, setJumping] = useState(null);
  const feedback = useRef({ frame: 0, timer: null });
  useEffect(() => () => {
    cancelAnimationFrame(feedback.current.frame);
    clearTimeout(feedback.current.timer);
  }, []);
  const branches = useMemo(() => flattenTree(nodes).filter((node) => node.children.length).map((node) => node.key), [nodes]);
  const keys = expanded ?? branches;
  const activate = (node) => {
    if (node.jumpLanguage) {
      cancelAnimationFrame(feedback.current.frame);
      clearTimeout(feedback.current.timer);
      setJumping(null);
      feedback.current.frame = requestAnimationFrame(() => {
        setJumping(node.key);
        feedback.current.timer = setTimeout(() => setJumping(null), 4000);
      });
      onJump?.(node.jumpLanguage, node.jumpIndex);
    }
    else if (node.children.length) setExpanded(keys.includes(node.key) ? keys.filter((key) => key !== node.key) : [...keys, node.key]);
  };
  return <section className="moki-tree knowledge-tree" aria-label={t('knowledgeTree.title')} contentEditable={false}
    onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
    <div className="knowledge-tree__header">
      <Tooltip title={title || t('knowledgeTree.title')} mouseEnterDelay={0.3}><span className="knowledge-tree__heading" >{title || t('knowledgeTree.title')}</span></Tooltip>
      <TreeControls onExpandAll={() => setExpanded(branches)} onCollapseAll={() => setExpanded([])} onOpen={onOpen} />
    </div>
    <div className="moki-tree__scroll"><div className="moki-tree__canvas">
      <TreeView nodes={nodes} expandedKeys={keys} onExpand={setExpanded}
        renderTitle={(node) => <TreeNodeRow node={node} highlighted={jumping === node.key}>
          <button type="button" className="moki-tree__title" onClick={(event) => { event.stopPropagation(); activate(node); }}>
            <InlineTreeTitle title={node.title || t('tree.newNode')} />
          </button>
        </TreeNodeRow>} onSelect={(_, info) => activate(info.node.treeNode)} />
    </div></div>
  </section>;
}
