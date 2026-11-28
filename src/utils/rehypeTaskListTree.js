import { collectTasks } from './taskListTree';

const element = (node, tag) => node?.type === 'element' && node.tagName === tag;
const checkbox = (node) => element(node, 'input') && node.properties.type === 'checkbox';

export default function rehypeTaskListTree({ cascade = true, preserveStates = false } = {}) {
  return (tree) => {
    const tasks = collectTasks(tree, (node) => node.children || [], (node) => {
      if (!element(node, 'li')) return null;
      const capturedState = preserveStates ? node.properties.dataTaskState : null;
      if (!capturedState && !node.properties.className?.includes('task-list-item')) return null;
      const label = node.children.find((child) => child.type !== 'text' || child.value.trim());
      const container = element(label, 'p') ? label : node;
      const existing = container.children.find(checkbox);
      if (!capturedState && !existing) return null;
      const input = existing || {
        type: 'element', tagName: 'input', properties: { type: 'checkbox' }, children: [],
      };
      const checked = capturedState ? capturedState === 'true' : input.properties.checked === true;
      return { node, label, input, container, capturedState, checked };
    });

    for (const task of tasks) {
      const { node, label, input, container } = task;
      const state = task.capturedState || (cascade ? task.state : String(task.checked));
      node.properties.dataTaskState = state;
      Object.assign(input.properties, {
        className: ['md-preview__task-checkbox'],
        checked: state === 'true',
        ariaChecked: state,
      });
      const index = container.children.indexOf(input);
      if (index !== -1) container.children.splice(index, 1);
      if (container === node) {
        const boundary = node.children.findIndex((child) => element(child, 'ul') || element(child, 'ol'));
        const labelChildren = node.children.splice(0, boundary < 0 ? node.children.length : boundary);
        if (labelChildren.length) {
          node.children.unshift({
            type: 'element', tagName: 'span',
            properties: { className: ['md-preview__task-label'] },
            children: labelChildren,
          });
        }
      } else {
        label.properties.className = [...(label.properties.className || []), 'md-preview__task-label'];
      }
      node.children.unshift(input);
    }
  };
}
