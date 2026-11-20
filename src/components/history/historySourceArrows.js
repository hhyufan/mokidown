export function mountHistorySourceArrows(container, modifiedEditor) {
  const layer = container.ownerDocument.createElement('div');
  layer.className = 'history-diff__source-arrows';
  container.append(layer);
  let arrows = [];
  let frame = 0;

  const layout = () => {
    frame = 0;
    const host = container.getBoundingClientRect();
    const pane = modifiedEditor.getContainerDomNode().getBoundingClientRect();
    const split = pane.left - host.left;
    const scroll = modifiedEditor.getScrollTop();
    const arrowSize = parseFloat(
      getComputedStyle(layer).getPropertyValue('--history-source-arrow-size'),
    );
    layer.style.setProperty('--history-source-split', `${split}px`);
    for (const { button, line, after } of arrows) {
      const offset = after
        ? line
          ? modifiedEditor.getBottomForLineNumber(line)
          : 0
        : modifiedEditor.getTopForLineNumber(line);
      const top = pane.top - host.top + offset - scroll;
      button.style.top = `${top}px`;
      button.hidden = !pane.width || top + arrowSize <= 0 || top >= host.height;
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(layout);
  };
  const listeners = [
    modifiedEditor.onDidScrollChange(schedule),
    modifiedEditor.onDidLayoutChange(schedule),
    modifiedEditor.onDidContentSizeChange(schedule),
  ];

  return {
    update(entries) {
      arrows = entries.map((entry) => {
        const button = layer.ownerDocument.createElement('button');
        button.type = 'button';
        button.className = 'history-diff__source-arrow';
        button.dataset.direction = entry.direction;
        button.title = entry.label;
        button.setAttribute('aria-label', entry.label);
        button.addEventListener('mousedown', (event) => event.preventDefault());
        button.addEventListener('click', entry.run);
        const icon = layer.ownerDocument.createElement('span');
        icon.className = `codicon codicon-arrow-${entry.direction}`;
        icon.setAttribute('aria-hidden', 'true');
        button.append(icon);
        return { ...entry, button };
      });
      layer.replaceChildren(...arrows.map(({ button }) => button));
      schedule();
    },
    dispose() {
      if (frame) cancelAnimationFrame(frame);
      listeners.forEach((listener) => listener.dispose());
      layer.remove();
    },
  };
}
