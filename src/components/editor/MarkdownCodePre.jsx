import CodeBlockExecution from './CodeBlockExecution';
import { getCodeBlockLanguage } from '@/services/scriptRunner';
import { codeBlockKey } from '@utils/markdownCodeBlocks';
import { isAndroidRuntime } from '@utils/platform';
import { normalizeCodeLanguage } from '@utils/knowledgeTree';
import MarkdownTreeBlock from './MarkdownTreeBlock';

export default function MarkdownCodePre({ children, node, documentId, filePath, fileName, onTreeJump, ...props }) {
  const code = node?.children?.find((child) => child.tagName === 'code');
  const info = code?.properties?.className?.find((name) => name.startsWith('language-'))?.slice(9) || '';
  const language = getCodeBlockLanguage(info);
  const source = code?.children?.map((child) => child.value || '').join('').replace(/\n$/, '') || '';
  const isTree = /^(tree|mgtree)$/i.test(info);
  if (isTree) return <MarkdownTreeBlock source={source} filePath={filePath} onJump={onTreeJump} />;
  const attributes = { ...props, 'data-code-language': normalizeCodeLanguage(info), 'data-source-line': node?.position?.start?.line };
  if (!language || isAndroidRuntime()) return <pre {...attributes}>{children}</pre>;
  return <div className="md-runnable-code"><pre {...attributes}>{children}</pre>
    <CodeBlockExecution blockKey={codeBlockKey(documentId, node.data.mokidownBlockIndex)} language={language}
      source={source} filePath={filePath} fileName={fileName} />
  </div>;
}
