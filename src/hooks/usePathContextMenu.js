import { useTranslation } from 'react-i18next';
import { useEditorContextMenu } from './useEditorContextMenu';
import { isSafUri, showInExplorer } from '@utils/tauriApi';
import { isAndroidRuntime } from '@utils/platform';
import { isWebDemo } from '@utils/webDemo';

export default function usePathContextMenu(resetKey) {
  const { t } = useTranslation();
  const { menu, openMenu, closeMenu } = useEditorContextMenu(resetKey);
  return {
    menu, closeMenu,
    onPathMenu(event, path) {
      if (!path) return;
      openMenu(event, [
        { key: 'reveal', label: t('sidebar.explorer.openInExplorer'),
          disabled: isAndroidRuntime() || isSafUri(path) || isWebDemo(), run: () => showInExplorer(path) },
        { key: 'copyPath', label: t('editor.menu.copyPath'), run: () => navigator.clipboard.writeText(path) },
      ], 'path');
    },
  };
}
