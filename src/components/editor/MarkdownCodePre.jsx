import CodeBlockExecution from './CodeBlockExecution';
import { getCodeBlockLanguage } from '@/services/scriptRunner';
import { codeBlockKey } from '@utils/markdownCodeBlocks';
import { isAndroidRuntime } from '@utils/platform';
import { normalizeCodeLanguage } from '@utils/knowledgeTree';
import MarkdownTreeBlock from './MarkdownTreeBlock';
import HtmlCodePreview from './HtmlCodePreview';

export default function MarkdownCodePre({ children, node, documentId, filePath, fileName, onTreeJump, ...props }) {
  const code = node?.children?.find((child) => child.tagName === 'code');
  const info = code?.properties?.className?.find((name) => name.startsWith('language-'))?.slice(9) || '';
  const language = getCodeBlockLanguage(info);
  const text = (node) => node.value || node.children?.map(text).join('') || '';
  const source = text(code || {}).replace(/\n$/, '');
  const isTree = /^(tree|mgtree)$/i.test(info);
  if (isTree) return <MarkdownTreeBlock source={source} filePath={filePath} onJump={onTreeJump} />;
  const attributes = { ...props, 'data-code-language': normalizeCodeLanguage(info), 'data-source-line': node?.position?.start?.line };
  if (/^(html?|xhtml)$/i.test(info)) return <div className="md-html-code"><pre {...attributes}>{children}</pre>
    <HtmlCodePreview source={source} filePath={filePath} /></div>;
  if (!language || isAndroidRuntime()) return <pre {...attributes}>{children}</pre>;
  return <div className="md-runnable-code"><pre {...attributes}>{children}</pre>
    <CodeBlockExecution blockKey={codeBlockKey(documentId, node.data.mokidownBlockIndex)} language={language}
      source={source} filePath={filePath} fileName={fileName} />
  </div>;
}
