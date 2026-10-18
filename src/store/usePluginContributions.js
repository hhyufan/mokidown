import { create } from 'zustand';

/**
 * Contributions registered by running service plugins: commands, status bar
 * items and file-list icons. The editor UI reads this store, so a plugin can
 * blend into the app instead of living on its own page.
 */
const usePluginContributions = create((set) => ({
  commands: {},
  statusBar: [],
  fileIcons: [],
  fileBadges: [],
  pluginTasks: [],
  removeContribution: (pluginId, kind, id) => set((state) => kind === 'commands'
    ? { commands: Object.fromEntries(Object.entries(state.commands).filter(([, entry]) => entry.pluginId !== pluginId || entry.id !== id)) }
    : kind === 'statusBar' || kind === 'fileIcons' ? { [kind]: state[kind].filter((entry) => entry.pluginId !== pluginId || entry.id !== id) } : {}),
  registerCommand: (pluginId, command) =>
    set((state) => ({
      commands: { ...state.commands, [`${pluginId}:${command.id}`]: { ...command, pluginId } },
    })),
  addStatusBarItem: (pluginId, item) =>
    set((state) => ({
      statusBar: [
        ...state.statusBar.filter((entry) => !(entry.pluginId === pluginId && entry.id === item.id)),
        { ...item, pluginId },
      ],
    })),
  addFileIcon: (pluginId, icon) =>
    set((state) => ({
      fileIcons: [
        ...state.fileIcons.filter((entry) => !(entry.pluginId === pluginId && entry.id === icon.id)),
        { ...icon, pluginId },
      ],
    })),
  addFileBadge: (pluginId, badge) =>
    set((state) => ({
      fileBadges: [
        ...state.fileBadges.filter((entry) => !(entry.pluginId === pluginId && entry.id === badge.id)),
        { ...badge, pluginId },
      ],
    })),
  removeFileBadge: (pluginId, id) =>
    set((state) => ({ fileBadges: state.fileBadges.filter((entry) => !(entry.pluginId === pluginId && entry.id === id)) })),
  setPluginTask: (pluginId, task) =>
    set((state) => ({
      pluginTasks: [
        ...state.pluginTasks.filter((entry) => !(entry.pluginId === pluginId && entry.id === task.id)),
        { ...task, pluginId },
      ],
    })),
  removePluginTask: (pluginId, id) =>
    set((state) => ({ pluginTasks: state.pluginTasks.filter((entry) => !(entry.pluginId === pluginId && entry.id === id)) })),
  // Version sources shown in the sidebar timeline (plugin-provided lists).
  versionSources: [],
  setVersionSource: (pluginId, source) =>
    set((state) => ({
      versionSources: [
        ...state.versionSources.filter((entry) => !(entry.pluginId === pluginId && entry.path === source.path)),
        { ...source, pluginId },
      ],
    })),
  removeVersionSource: (pluginId, path) =>
    set((state) => ({
      versionSources: state.versionSources.filter((entry) => !(entry.pluginId === pluginId && entry.path === path)),
    })),
  clearPlugin: (pluginId) =>
    set((state) => ({
      commands: Object.fromEntries(
        Object.entries(state.commands).filter(([, command]) => command.pluginId !== pluginId),
      ),
      statusBar: state.statusBar.filter((item) => item.pluginId !== pluginId),
      fileIcons: state.fileIcons.filter((item) => item.pluginId !== pluginId),
      fileBadges: state.fileBadges.filter((item) => item.pluginId !== pluginId),
      pluginTasks: state.pluginTasks.filter((item) => item.pluginId !== pluginId),
      versionSources: state.versionSources.filter((item) => item.pluginId !== pluginId),
    })),
}));

export default usePluginContributions;
