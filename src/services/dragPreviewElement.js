export function createDragPreviewElement(preview) {
  if (preview.markup) {
    const template = document.createElement('template');
    template.innerHTML = preview.markup;
    const snapshot = template.content.firstElementChild;
    if (snapshot) return snapshot;
  }
  const card = document.createElement('div');
  card.className = 'drag-preview';
  card.style.background = preview.background;
  card.style.color = preview.color;
  card.style.borderColor = preview.border;
  Object.assign(card.style, preview.appearance);
  card.style.width = `${preview.width || 260}px`;
  card.style.height = `${preview.height || 36}px`;
  if (preview.icon) {
    const icon = document.createElement('img');
    icon.src = preview.icon;
    icon.alt = '';
    card.append(icon);
  }
  const name = document.createElement('span');
  name.textContent = preview.name;
  card.append(name);
  return card;
}
