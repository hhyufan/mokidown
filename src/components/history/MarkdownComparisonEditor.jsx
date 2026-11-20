import { Suspense, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FloatingToolbar from '@components/editor/FloatingToolbar';
import { applyMarkdownToolbarAction } from '@components/editor/applyMarkdownToolbarAction';
import { lazyWithRetry } from '@utils/lazyWithRetry';

const MilkdownMarkdownEditor = lazyWithRetry(
  () => import('@components/editor/MilkdownMarkdownEditor'),
);

export default function MarkdownComparisonEditor({
  tabId,
  content,
  onDraftChange,
  busy,
  layout,
  boundsRef,
  previewBoundsRef,
  readOnly = false,
  onReady,
}) {
  const { t } = useTranslation();
  const [initialContent] = useState(content);
  const editorRef = useRef(null);

  return (
    <>
      <section
        className="history-markdown-draft__pane"
        data-side={readOnly ? 'original' : 'modified'}
        aria-busy={busy}
        inert={!readOnly && busy ? '' : undefined}
      >
        <Suspense fallback={<div role="status">{t('editor.loading')}</div>}>
          <MilkdownMarkdownEditor
            ref={editorRef}
            className="editor-content__preview editor-content__editor--milkdown history-markdown-draft__editor"
            readOnly={readOnly}
            comparison={{
              tabId,
              initialContent,
              content,
              onChange: onDraftChange,
              layout,
              onReady,
              previewBoundsRef,
            }}
          />
        </Suspense>
      </section>
      {!readOnly && (
        <FloatingToolbar
          boundsRef={boundsRef}
          onInsert={(action) => {
            if (!busy && editorRef.current?.getEditor()?.status === 'Created') {
              applyMarkdownToolbarAction(editorRef.current, action);
            }
          }}
        />
      )}
    </>
  );
}
