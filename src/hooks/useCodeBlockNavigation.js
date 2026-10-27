import { useCallback, useEffect, useRef } from 'react';
import i18n from '@/i18n';
import useEditorStore from '@store/useEditorStore';
import useToastStore from '@store/useToastStore';

// Both Markdown renderers use the same feedback and timing. Scroll after the
// editor's own layout/restoration frames, then keep the target visible long
// enough to recognize it even when smooth scrolling covers a long document.
export function useCodeBlockNavigation(documentId, resolveTarget, ready = true, beforeJump) {
  const request = useEditorStore((s) => s.knowledgeJump);
  const pending = useRef(null);
  const clear = useCallback(() => {
    const previous = pending.current;
    if (!previous) return;
    cancelAnimationFrame(previous.frame);
    clearTimeout(previous.timer);
    previous.target.classList.remove('knowledge-tree-target');
    pending.current = null;
  }, []);
  useEffect(() => clear, [documentId, clear]);
  const jump = useCallback((language, index) => {
    const target = resolveTarget(language, index);
    if (!target) {
      useToastStore.getState().toast(i18n.t('knowledgeTree.missingCode', { language, index }));
      return;
    }
    clear();
    beforeJump?.(target);
    const job = { target, frame: 0, timer: null };
    pending.current = job;
    job.frame = requestAnimationFrame(() => {
      job.frame = requestAnimationFrame(() => {
        target.classList.add('knowledge-tree-target');
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        job.timer = setTimeout(clear, 4000);
      });
    });
  }, [resolveTarget, beforeJump, clear]);
  useEffect(() => {
    if (!ready || !request || request.tabId !== documentId) return;
    jump(request.language, request.index);
    if (useEditorStore.getState().knowledgeJump === request) useEditorStore.setState({ knowledgeJump: null });
  }, [documentId, ready, request, jump]);
  return jump;
}
