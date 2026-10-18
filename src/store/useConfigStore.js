/**
 * ?????????
 *
 * ????????????????????????????????????
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { readInitialLanguage } from '@/i18n/language';
import { DEFAULT_HOTKEYS, findHotkeyConflicts, resolveHotkeys } from '@/configs/hotkeys';
import { validateKeybinding } from '@utils/keybinding';

const DEVICE_LOCAL_CONFIG_KEYS = new Set([
  'workspacePath',
  'backgroundImage', 'backgroundImageName', 'backgroundEnabled', 'backgroundTransparency',
  // 键位取决于本机键盘布局与外接键盘，跨设备同步会把别人机器上的手感带过来。
  'hotkeys',
  // 品牌标识属于本机外观偏好，不必跟着账号同步到其它设备。
  'mokiIcon',
]);
const initialLanguage = readInitialLanguage();

async function invalidateHotkeyProbeCache() {
  try {
    const { clearHotkeyProbeCache } = await import('@utils/hotkeyProbe');
    clearHotkeyProbeCache();
  } catch (error) {
    console.warn('[useConfigStore] Failed to clear hotkey probe cache:', error);
  }
}

/**
 * 编辑器与预览配置 store。
 *
 * 聚合字体、行高、语言、自动保存、服务端地址等偏持久化的用户配置，并用
 * `configUpdatedAt` 记录最近一次有效变更时间，供设置同步层比较新旧。
 */
const useConfigStore = create(
  persist(
    (set) => ({
      language: initialLanguage,
      fontSize: 14,
      previewFontSize: 14,
      fontFamily: 'JetBrains Mono',
      lineHeight: 24,
      previewLineHeight: 24,
      previewZoomSync: true,
      tabSize: 2,
      wordWrap: true,
      lineNumbers: true,
      minimap: { enabled: false },
      backgroundImage: '',
      backgroundImageName: '',
      backgroundEnabled: false,
      backgroundTransparency: { dark: 80, light: 80 },
      mokiDisplay: 'welcome',
      // 是否用 Moki 形象徽章替换界面左上角的 M 图标。纯外观偏好，默认关闭。
      mokiIcon: false,
      autoSave: true,
      workspacePath: '',

      hotkeys: { ...DEFAULT_HOTKEYS },
      configUpdatedAt: 0,
      settingsUpdatedAt: 0,

      /**
       * 按单个键更新配置，并同步刷新配置时间戳。
       */
      setConfig: (key, value, meta = {}) => set((state) => ({
        ...state,
        [key]: value,
        configUpdatedAt: meta.updatedAt ?? Date.now(),
        settingsUpdatedAt: DEVICE_LOCAL_CONFIG_KEYS.has(key)
          ? state.settingsUpdatedAt
          : meta.updatedAt ?? Date.now(),
      })),
      /**
       * 修改单个快捷键。
       *
       * 冲突与非法键位在这里就被拒绝，而不是等用户保存完再回滚——否则界面会先
       * 显示一个生效的绑定，实际却被匹配逻辑忽略，排查起来非常费解。
       *
       * @param {string} actionId 动作标识。
       * @param {string} keybinding 归一化键位，空串表示禁用。
       * @param {object} [meta] 附加元信息，可携带 `updatedAt`。
       * @returns {{ok: boolean, reason?: string, conflictWith?: string}} 处理结果。
       */
      setHotkey: (actionId, keybinding, meta = {}) => {
        let result = { ok: true };
        set((state) => {
          const current = resolveHotkeys(state.hotkeys);
          if (!(actionId in current)) {
            result = { ok: false, reason: 'unknownAction' };
            return state;
          }
          if (keybinding !== '') {
            const validation = validateKeybinding(keybinding);
            if (!validation.ok) {
              result = { ok: false, reason: validation.reason };
              return state;
            }
          }
          const next = { ...current, [actionId]: keybinding };
          if (keybinding !== '') {
            const conflicts = findHotkeyConflicts(next);
            const clash = conflicts.get(keybinding)?.find((id) => id !== actionId);
            if (clash) {
              result = { ok: false, reason: 'conflict', conflictWith: clash };
              return state;
            }
          }
          return {
            ...state,
            hotkeys: next,
            configUpdatedAt: meta.updatedAt ?? Date.now(),
            settingsUpdatedAt: state.settingsUpdatedAt,
          };
        });
        return result;
      },
      /**
       * 把全部快捷键恢复为默认值。
       */
      resetHotkeys: () => {
        // 键位全部回退后，之前问到的系统占用结论同样不再适用。
        void invalidateHotkeyProbeCache();
        set((state) => ({
          ...state,
          hotkeys: { ...DEFAULT_HOTKEYS },
          configUpdatedAt: Date.now(),
          settingsUpdatedAt: state.settingsUpdatedAt,
        }));
      },
      
      loadConfig: (config, meta = {}) => {
        // 导入/回放的键位必须归一化：快照可能来自旧版本（含已下线的动作 id）
        // 或被手工改过，直接铺开会让非法组合进入键位表。同时作废探测缓存——
        // 键位表整体换了之后，之前问到的“是否被系统占用”不再适用。
        const hasHotkeys = Boolean(config && 'hotkeys' in config);
        if (hasHotkeys) void invalidateHotkeyProbeCache();
        set((state) => ({
          ...state,
          ...config,
          ...(hasHotkeys ? { hotkeys: resolveHotkeys(config.hotkeys) } : {}),
          configUpdatedAt: meta.updatedAt ?? state.configUpdatedAt ?? Date.now(),
          settingsUpdatedAt: Object.keys(config || {}).some(
            (key) => !DEVICE_LOCAL_CONFIG_KEYS.has(key)
          )
            ? meta.updatedAt ?? Date.now()
            : state.settingsUpdatedAt,
        }));
      },
    }),
    {
      name: 'mokidown-config',
      // Retire the editor companion without restoring it from older local preferences.
      merge: (persisted, current) => {
        const merged = { ...current, ...Object.fromEntries(Object.entries(persisted || {}).filter(([key]) => key in current)) };

        if (merged.mokiDisplay === 'companion') merged.mokiDisplay = 'welcome';
        delete merged.mokiSize;
        delete merged.mokiCollapsed;
        // 周边轻动效开关已下线：飘散动画改为常驻并遵从系统偏好，旧配置里的键直接清掉。
        delete merged.mokiMotion;
        // 键位表补齐缺失动作、剔除已下线的动作 id：旧版本遗留的数据不该让
        // “未绑定”或幽灵动作进入设置界面。
        merged.hotkeys = resolveHotkeys(persisted?.hotkeys);
        return merged;
      },
    }
  )
);

export default useConfigStore;
