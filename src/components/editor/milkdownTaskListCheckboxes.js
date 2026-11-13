import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { splitListItem } from '@milkdown/kit/prose/schema-list';
import { closeHistory } from '@milkdown/kit/prose/history';
import i18n from '@/i18n';
import useConfigStore from '@store/useConfigStore';
import { isImeComposing } from '@utils/keyboard';
import { collectTasks, toggleTaskBranch } from '@utils/taskListTree';

const taskListKey = new PluginKey('mokiTaskListCheckboxes');
const cascadeEnabled = () => useConfigStore.getState().markdownTaskCascade !== false;

function documentTasks(doc) {
  return collectTasks({ node: doc, pos: -1 }, ({ node, pos }) => {
    const children = [];
    if (!node.isTextblock) node.forEach((child, offset) => children.push({ node: child, pos: pos + 1 + offset }));
    return children;
  }, ({ node, pos }) => node.type.name === 'list_item' && typeof node.attrs.checked === 'boolean'
    ? { node, pos, checked: node.attrs.checked }
    : null);
}

function toggle(view, pos) {
  if (!view.editable || view.composing) return;
  const task = documentTasks(view.state.doc).find((item) => item.pos === pos);
  if (!task) return;
  const tr = closeHistory(view.state.tr);
  const setChecked = ({ node, pos: itemPos }, checked) => {
    if (node.attrs.checked !== checked) tr.setNodeAttribute(itemPos, 'checked', checked);
  };
  if (cascadeEnabled()) toggleTaskBranch(task, setChecked);
  else setChecked(task, !task.checked);
  if (tr.docChanged) view.dispatch(tr);
  view.focus();
}

function decorations(doc) {
  const cascade = cascadeEnabled();
  const widgets = documentTasks(doc).flatMap((task) => {
    const { node, pos } = task;
    const state = cascade ? task.state : String(task.checked);
    return [
      Decoration.node(pos, pos + node.nodeSize, { 'data-task-state': state }),
      Decoration.widget(pos + 2, (view, getPos) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'md-preview__task-checkbox';
        button.setAttribute('role', 'checkbox');
        button.setAttribute('aria-checked', state);
        button.setAttribute('aria-label', i18n.t('toolbar.taskList'));
        button.disabled = !view.editable;
        button.addEventListener('mousedown', (event) => event.preventDefault());
        button.addEventListener('click', () => {
          const position = getPos();
          if (typeof position === 'number') toggle(view, position - 2);
        });
        return button;
      }, { key: `moki-task-checkbox-${state}`, side: -1, stopEvent: () => true, ignoreSelection: true }),
    ];
  });
  return DecorationSet.create(doc, widgets);
}

export function milkdownTaskListCheckboxes(marker, convertMarker) {
  return $prose(() => new Plugin({
    key: taskListKey,
    state: {
      init: (_, state) => decorations(state.doc),
      apply: (tr, previous) => tr.docChanged || tr.getMeta(taskListKey) ? decorations(tr.doc) : previous,
    },
    view: (view) => ({
      destroy: useConfigStore.subscribe((next, previous) => {
        if (next.markdownTaskCascade !== previous.markdownTaskCascade) {
          view.dispatch(view.state.tr.setMeta(taskListKey, true).setMeta('addToHistory', false));
        }
      }),
    }),
    props: {
      decorations: (state) => taskListKey.getState(state),
      handleDOMEvents: {
        keydown(view, event) {
          const { $from, empty } = view.state.selection;
          if (!view.editable || event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey
            || event.altKey || view.composing || isImeComposing(event) || event.target.closest?.('.cm-editor, input, textarea, button')) return false;
          const match = empty && $from.parentOffset === $from.parent.content.size && marker.exec(`${$from.parent.textContent} `);
          const tr = match && convertMarker(view.state, match, $from.start(), $from.pos);
          if (tr) {
            event.preventDefault();
            view.dispatch(tr.scrollIntoView());
            return true;
          }
          const item = $from.depth > 1 ? $from.node(-1) : null;
          if (item?.type.name !== 'list_item' || typeof item.attrs.checked !== 'boolean' ||
              $from.index(-1) !== 0 || !$from.parent.content.size) return false;
          const split = splitListItem(item.type);
          if (!split(view.state, (transaction) => {
            const cursor = transaction.selection.$from;
            const nextItem = cursor.node(-1);
            view.dispatch(transaction.setNodeMarkup(cursor.before(-1), undefined, { ...nextItem.attrs, checked: false }));
          })) return false;
          event.preventDefault();
          return true;
        },
      },
    },
  }));
}
