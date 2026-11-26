import { Suspense, useRef, useState } from 'react';
import FloatingToolbar from '@components/editor/FloatingToolbar';
import { applyMarkdownToolbarAction } from '@components/editor/applyMarkdownToolbarAction';
import { MilkdownEditor } from '@utils/editorRendererBoot';

export default function MarkdownComparisonEditor({
  tabId,
  content,
  filePath,
  onDraftChange,
  busy,
  layout,
  boundsRef,
  previewBoundsRef,
  readOnly = false,
  side = readOnly ? 'original' : 'modified',
  onReady,
}) {
  const [initialContent] = useState(content);
  const editorRef = useRef(null);

  return (
    <>
      <section
        className="history-markdown-draft__pane"
        data-side={side}
        aria-busy={busy}
        inert={!readOnly && busy ? '' : undefined}
      >
        <Suspense fallback={null}>
          <MilkdownEditor
            ref={editorRef}
            className="editor-content__preview editor-content__editor--milkdown history-markdown-draft__editor"
            readOnly={readOnly}
            comparison={{
              tabId,
              filePath,
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
