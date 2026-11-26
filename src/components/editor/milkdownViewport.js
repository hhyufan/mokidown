// Milkdown creates CodeMirror only near the viewport. Wait for visible code
// blocks to replace their plain-text placeholders before revealing the editor.
export function hasPendingMilkdownCodeBlocks(viewport) {
  const placeholders = viewport.querySelectorAll(
    '.milkdown-editor .milkdown-code-block > .milkdown-code-block-placeholder',
  );
  if (!placeholders.length) return false;
  const bounds = viewport.getBoundingClientRect();
  const window = viewport.ownerDocument.defaultView;
  const top = Math.max(0, bounds.top);
  const left = Math.max(0, bounds.left);
  const bottom = Math.min(window.innerHeight, bounds.bottom);
  const right = Math.min(window.innerWidth, bounds.right);
  for (const placeholder of placeholders) {
    const rect = placeholder.getBoundingClientRect();
    if (
      rect.width &&
      rect.height &&
      rect.bottom > top &&
      rect.top < bottom &&
      rect.right > left &&
      rect.left < right
    )
      return true;
  }
  return false;
}
