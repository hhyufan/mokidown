import { useKnowledgeTrees } from '@hooks/useKnowledgeTrees';
import KnowledgeTree from './KnowledgeTree';
import { useOpenTreeEditor } from '@hooks/useOpenTreeEditor';

export default function MarkdownTreeBlock({ source, filePath, onJump }) {
  const trees = useKnowledgeTrees(filePath, `\x60\x60\x60tree\n${source}\n\x60\x60\x60`, true, false);
  const openTreeEditor = useOpenTreeEditor();
  if (!trees.length) return <pre><code>{source}</code></pre>;
  return <>{trees.map((tree) => <KnowledgeTree key={tree.key} source={tree.source} onJump={onJump}
    onOpen={tree.path ? () => openTreeEditor(tree.path) : undefined} />)}</>;
}
