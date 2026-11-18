import useEditorStore from '@store/useEditorStore';
import { useEditorBufferContent } from '@hooks/useEditorBufferContent';
import HtmlPreview from './HtmlPreview';

export default function HtmlFilePreview({ className }) {
  const activeId = useEditorStore((state) => state.activeTabId);
  const tab = useEditorStore((state) => state.tabRenderList.find((tab) => tab.id === activeId));
  const fallback = useEditorStore.getState().tabs.find((tab) => tab.id === activeId)?.content || '';
  const source = useEditorBufferContent(activeId, fallback, 100);
  return <HtmlPreview source={source} filePath={tab?.path} title={tab?.name} className={className} />;
}
