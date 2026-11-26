/**
 * 快捷键配置 hook。
 *
 * 把「持久化的用户键位」与「注册表默认值」合并成一份可直接用于匹配的键位表，
 * 并对外提供按事件查动作的能力。所有快捷键消费方（App 全局、Monaco、
 * 设置界面）都走这里，避免各自维护一份解析逻辑。
 */
import { useCallback, useMemo } from 'react';
import useConfigStore from '@store/useConfigStore';
import { HOTKEY_ACTIONS, HOTKEY_ACTION_MAP, resolveHotkeys } from '@/configs/hotkeys';
import { matchesKeybinding } from '@utils/keybinding';

let lastStored;
let resolved;
/**
 * 读取完整的键位表（用户配置 + 默认值补齐）。
 *
 * 这是非 hook 环境下的入口，供 Monaco 注册等命令式代码使用。
 *
 * @returns {Record<string, string>} 动作标识到归一化键位的映射。
 */
export function getResolvedHotkeys() {
  const stored = useConfigStore.getState().hotkeys;
  if (stored !== lastStored || !resolved) {
    lastStored = stored;
    resolved = resolveHotkeys(stored);
  }
  return resolved;
}

export function matchesHotkey(event, ...actionIds) {
  const hotkeys = getResolvedHotkeys();
  return actionIds.find((id) => matchesAction(event, HOTKEY_ACTION_MAP.get(id), hotkeys[id]));
}

function matchesAction(event, action, binding) {
  return matchesKeybinding(event, binding) ||
    (binding === action.defaultKeybinding && action.aliases?.some((key) => matchesKeybinding(event, key)));
}

export function replacedHotkey(event, ...ids) {
  const stored = useConfigStore.getState().hotkeys;
  return ids.some((id) => {
    const action = HOTKEY_ACTION_MAP.get(id);
    return typeof stored[id] === 'string' && stored[id] !== action.defaultKeybinding &&
      matchesAction(event, action, action.defaultKeybinding);
  });
}
/**
 * 订阅快捷键配置。
 *
 * @returns {object} 键位表与匹配工具。
 */
export function useHotkeys() {
  const stored = useConfigStore((state) => state.hotkeys);
  const hotkeys = useMemo(() => resolveHotkeys(stored), [stored]);

  /**
   * 找出与一次键盘事件匹配的动作。
   *
   * @param {KeyboardEvent} event 键盘事件。
   * @param {'app'|'editor'} [scope] 只在该作用域内查找。
   * @returns {object|undefined} 命中的动作定义。
   */
  const matchAction = useCallback((event, scope) => HOTKEY_ACTIONS.find((action) => {
    if (scope && action.scope !== scope) return false;
    return matchesAction(event, action, hotkeys[action.id]);
  }), [hotkeys]);

  /**
   * 读取某个动作当前的键位。
   *
   * @param {string} actionId 动作标识。
   * @returns {string} 归一化键位，未绑定时为空串。
   */
  const keybindingOf = useCallback((actionId) => hotkeys[actionId] ?? '', [hotkeys]);

  return { hotkeys, matchAction, keybindingOf };
}

export default useHotkeys;
