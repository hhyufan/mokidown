import { useCallback } from 'react';
import { useFileManager } from './useFileManager';
import useEditorStore from '@store/useEditorStore';

export function useOpenTreeEditor() {
  const { openFileFromPath } = useFileManager();
  return useCallback(async (path) => {
    await openFileFromPath(path, path.split(/[\\/]/).pop());
    const state = useEditorStore.getState();
    const active = state.tabs.find((tab) => tab.id === state.activeTabId);
    if (active?.path?.replace(/\\/g, '/') === path.replace(/\\/g, '/')) state.setViewMode('preview');
  }, [openFileFromPath]);
}
