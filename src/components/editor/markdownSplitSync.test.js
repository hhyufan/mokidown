import { expect, it, vi } from 'vitest';
import { bindMarkdownScroll } from './markdownSplitSync';

it('keeps the source scroll position on resize after scrolling the preview', () => {
  vi.useFakeTimers();
  const editorSize = { width: 500, height: 400 };
  const previewSize = { width: 500, height: 400 };
  const preview = document.createElement('div');
  Object.defineProperties(preview, {
    clientWidth: { get: () => previewSize.width },
    clientHeight: { get: () => previewSize.height },
    scrollHeight: { value: 2400 },
  });
  const emptySubscription = () => ({ dispose() {} });
  let onLayout;
  let editorScroll = 200;
  const editor = {
    getLayoutInfo: () => editorSize,
    getScrollHeight: () => 1400,
    getScrollTop: () => editorScroll,
    getModel: () => null,
    setScrollTop: vi.fn((top) => {
      editorScroll = top;
    }),
    onDidLayoutChange: (callback) => {
      onLayout = callback;
      return emptySubscription();
    },
    onDidScrollChange: emptySubscription,
    onDidChangeHiddenAreas: emptySubscription,
    onDidChangeModelContent: emptySubscription,
  };
  const unbind = bindMarkdownScroll(editor, preview);
  try {
    preview.scrollTop = 900;
    preview.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(32);
    expect(editorScroll).toBe(450);

    editorSize.width = 680;
    previewSize.height = 700;
    onLayout();
    vi.advanceTimersByTime(128);
    expect(editor.setScrollTop).toHaveBeenCalledTimes(1);
    expect(preview.scrollTop).toBe(765);
  } finally {
    unbind();
    vi.useRealTimers();
  }
});
