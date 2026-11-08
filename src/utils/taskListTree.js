// A task may have non-task list items between it and its nearest task children.
export function collectTasks(root, childrenOf, taskOf) {
  const tasks = [];
  function visit(node, parent) {
    const data = taskOf(node);
    const task = data && { ...data, parent, children: [] };
    if (task) {
      tasks.push(task);
      parent?.children.push(task);
    }
    for (const child of childrenOf(node)) visit(child, task || parent);
    if (task) task.state = taskState(task);
  }
  visit(root, null);
  return tasks;
}

function taskState(task) {
  if (!task.children.length) return task.checked ? 'true' : 'false';
  if (task.children.every((child) => child.state === 'true')) return 'true';
  if (task.children.every((child) => child.state === 'false')) return 'false';
  return 'mixed';
}

export function toggleTaskBranch(task, setChecked) {
  const checked = task.state === 'false';
  function visit(current) {
    current.state = String(checked);
    setChecked(current, checked);
    for (const child of current.children) visit(child);
  }
  visit(task);
  for (let parent = task.parent; parent; parent = parent.parent) {
    parent.state = taskState(parent);
    setChecked(parent, parent.state === 'true');
  }
}
