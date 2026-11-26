import { useCallback, useEffect } from 'react';
import i18n from '@/i18n';
import useEditorStore from '@store/useEditorStore';
import useNotificationStore from '@store/useNotificationStore';
import { useMarkdownJumpFeedback } from './useMarkdownJumpFeedback';

// Both Markdown renderers use the same feedback and timing. Scroll after the
// editor's own layout/restoration frames, then keep the target visible long
// enough to recognize it even when smooth scrolling covers a long document.
export function useCodeBlockNavigation(documentId, resolveTarget, ready = true, beforeJump) {
  const request = useEditorStore((s) => s.knowledgeJump);
  const showFeedback = useMarkdownJumpFeedback(documentId);
  const jump = useCallback((language, index) => {
    const target = resolveTarget(language, index);
    if (!target) {
      useNotificationStore.getState().notify('info', i18n.t('knowledgeTree.missingCode', { language, index }), '', 2500);
      return;
    }
    beforeJump?.(target);
    showFeedback(target, { className: 'knowledge-tree-target' });
  }, [resolveTarget, beforeJump, showFeedback]);
  useEffect(() => {
    if (!ready || !request || request.tabId !== documentId) return;
    jump(request.language, request.index);
    if (useEditorStore.getState().knowledgeJump === request) useEditorStore.setState({ knowledgeJump: null });
  }, [documentId, ready, request, jump]);
  return jump;
}
