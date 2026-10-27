import { Tree, Tooltip } from 'antd';
import { CodeOutlined, EditOutlined } from '@ant-design/icons';
import TreeExpansionIcon from '@components/ui/TreeExpansionIcon';
import { useTranslation } from 'react-i18next';
import './tree-editor.scss';

export function InlineTreeTitle({ title }) {
  return title.split(/(`[^`]+`)/g).map((part, index) => part.startsWith('`') && part.endsWith('`')
    ? <code key={index}>{part.slice(1, -1)}</code> : part);
}

export function TreeNodeRow({ node, children, actions, onContextMenu, showReference = true, highlighted = false, reference }) {
  return <div className={`moki-tree__node ${node.jumpLanguage ? 'moki-tree__node--linked' : ''} ${highlighted ? 'moki-tree__node--jumping' : ''}`} onContextMenu={onContextMenu}>
    {node.jumpLanguage && <CodeOutlined className="moki-tree__icon" />}
    {children}
    {reference ?? (node.jumpLanguage && showReference && <span className="moki-tree__reference" title={node.originalText}>
      {node.jumpLanguage}<span>{node.jumpIndex}</span>
    </span>)}
    {actions}
  </div>;
}

export function TreeControls({ onExpandAll, onCollapseAll, onOpen }) {
  const { t } = useTranslation();
  const action = (label, icon, onClick) => <Tooltip title={label} placement="bottom" mouseEnterDelay={0.3}>
    <button type="button" aria-label={label} onClick={onClick}>{icon}</button>
  </Tooltip>;
  return <div className="moki-tree__corner-controls" contentEditable={false}>
    {onOpen && action(t('knowledgeTree.openEditor'), <EditOutlined />, onOpen)}
    {action(t('tree.collapseAll'), <TreeExpansionIcon collapse />, onCollapseAll)}
    {action(t('tree.expandAll'), <TreeExpansionIcon />, onExpandAll)}
  </div>;
}

export default function TreeView({ nodes, expandedKeys, onExpand, renderTitle, onSelect }) {
  const renderNode = (node, index, siblings, depth = 0) => ({
    key: node.key,
    className: [index === siblings.length - 1 ? 'moki-tree__last' : '',
      depth === 0 ? 'moki-tree__root' : '',
      depth === 0 && index === 0 ? 'moki-tree__root--first' : '',
      depth === 0 && index === siblings.length - 1 ? 'moki-tree__root--last' : '',
    ].filter(Boolean).join(' '),
    title: renderTitle(node),
    children: node.children.map((child, childIndex, children) => renderNode(child, childIndex, children, depth + 1)),
    treeNode: node,
  });
  return <Tree treeData={nodes.map(renderNode)} expandedKeys={expandedKeys} onExpand={onExpand} onSelect={onSelect}
    selectedKeys={[]}
    blockNode showIcon={false} showLine={{ showLeafIcon: false }} />;
}
