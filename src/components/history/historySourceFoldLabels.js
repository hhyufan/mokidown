const hiddenLineLabels =
  '.diff-hidden-lines > .center > div:nth-child(2) > span:first-child, .diff-hidden-lines-compact > .text';
const marginHoverLabels = '[widgetid="editor.contrib.modesGlyphHoverWidget"] .hover-contents p';

export function mountHistorySourceFoldLabels(container, translate) {
  const overlays = [...container.querySelectorAll('.monaco-editor .overlayWidgets')];
  const counts = new WeakMap();

  const update = () => {
    for (const overlay of overlays) {
      for (const label of overlay.querySelectorAll(hiddenLineLabels)) {
        const text = label.firstChild;
        if (text?.nodeType !== Node.TEXT_NODE || text.nextSibling) continue;
        const match = /^(\d+) hidden lines$/.exec(text.data);
        if (match) counts.set(text, Number(match[1]));
        const count = counts.get(text);
        if (count === undefined) continue;
        const localized = translate('history.hiddenLines', { count });
        if (text.data !== localized) text.data = localized;
      }
      for (const label of overlay.querySelectorAll(marginHoverLabels)) {
        if (label.textContent === 'Fold Unchanged Region') {
          label.closest('.hover-row')?.setAttribute('data-history-native-fold-tooltip', '');
        }
      }
    }
  };

  // Folding widgets replace their label nodes when the hidden range changes.
  // Watch the overlay layer so typing and scrolling through code don't trigger a scan.
  const observer = new MutationObserver(update);
  for (const overlay of overlays) observer.observe(overlay, { childList: true, subtree: true });
  update();

  return { update, dispose: () => observer.disconnect() };
}
