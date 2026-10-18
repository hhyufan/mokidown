export function getPluginDocuments(state, workspace) {
  const root = String(workspace || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return state.tabs.map((tab) => {
    const path = String(tab.path || '').replace(/\\/g, '/');
    const windows = /^[a-z]:/i.test(root);
    const contained = root && (windows ? path.toLowerCase().startsWith(`${root.toLowerCase()}/`) : path.startsWith(`${root}/`));
    const metadata = state.tabRenderList?.find((item) => item.id === tab.id) || tab;
    return { id: tab.id, path: tab.path || null, name: tab.name, relativePath: contained ? path.slice(root.length + 1) : null, active: tab.id === state.activeTabId, modified: Boolean(metadata.modified) };
  });
}
