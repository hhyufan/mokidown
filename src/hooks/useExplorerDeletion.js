import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useFileStore from '@store/useFileStore';
import useNotificationStore from '@store/useNotificationStore';
import { deleteFile } from '@utils/tauriApi';

export default function useExplorerDeletion(onDeleted) {
  const { t } = useTranslation();
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const pending = useRef(false);
  return {
    request(target, event) {
      event?.stopPropagation();
      if (!pending.current) setFile(target);
    },
    dialog: {
      file, loading,
      onCancel: () => { if (!pending.current) setFile(null); },
      onConfirm: async () => {
        if (!file || pending.current) return;
        pending.current = true;
        setLoading(true);
        try {
          const result = await deleteFile(file.path);
          if (!result?.success) throw new Error(result?.message || result?.error || file.path);
          setFile(null);
          const store = useFileStore.getState();
          if (store.isBookmarked(file.path)) store.toggleBookmark(file.path);
          store.removeRecentFile(file.path);
          await onDeleted(file);
        } catch (error) {
          useNotificationStore.getState().notify('error', t('notification.error'), String(error));
        } finally {
          pending.current = false;
          setLoading(false);
        }
      },
    },
  };
}
