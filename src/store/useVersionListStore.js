import { create } from 'zustand';

/**
 * Generic version list opened by a plugin (`editor.showVersions`). The editor
 * only renders the entries; what a "version" means is entirely the plugin's
 * business.
 */
const useVersionListStore = create((set) => ({
  open: false,
  pluginId: null,
  tabId: null,
  path: '',
  title: '',
  items: [],
  show: ({ pluginId, tabId = null, path = '', title = '', items = [] }) =>
    set({ open: true, pluginId, tabId, path, title: title || path, items: Array.isArray(items) ? items : [] }),
  close: () => set({ open: false, pluginId: null, tabId: null, path: '', title: '', items: [] }),
}));

export default useVersionListStore;
