import { collectTasks } from './taskListTree';

const element = (node, tag) => node?.type === 'element' && node.tagName === tag;
const checkbox = (node) => element(node, 'input') && node.properties.type === 'checkbox';

export default function rehypeTaskListTree({ cascade = true } = {}) {
  return (tree) => {
    const tasks = collectTasks(tree, (node) => node.children || [], (node) => {
      if (!element(node, 'li') || !node.properties.className?.includes('task-list-item')) return null;
      const label = node.children.find((child) => child.type !== 'text' || child.value.trim());
      const container = element(label, 'p') ? label : node;
      const input = container.children.find(checkbox);
      return input && { node, label, input, container, checked: input.properties.checked === true };
    });

    for (const task of tasks) {
      const { node, label, input, container } = task;
      const state = cascade ? task.state : String(task.checked);
      node.properties.dataTaskState = state;
      Object.assign(input.properties, {
        className: ['md-preview__task-checkbox'],
        checked: state === 'true',
        ariaChecked: state,
      });
      container.children.splice(container.children.indexOf(input), 1);
      if (container === node) {
        const boundary = node.children.findIndex((child) => element(child, 'ul') || element(child, 'ol'));
        const labelChildren = node.children.splice(0, boundary < 0 ? node.children.length : boundary);
        node.children.unshift({
          type: 'element', tagName: 'span',
          properties: { className: ['md-preview__task-label'] },
          children: labelChildren,
        });
      } else {
        label.properties.className = [...(label.properties.className || []), 'md-preview__task-label'];
      }
      node.children.unshift(input);
    }
  };
}
