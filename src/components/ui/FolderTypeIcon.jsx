import { getFolderIconUrl } from '@utils/folderIcons';

export default function FolderTypeIcon({ fileName = '', isExpanded = false, size = 16, className = '', fallback = null }) {
  const src = getFolderIconUrl(fileName, isExpanded);
  if (!src) return fallback;

  return (
    <img
      src={src}
      width={size}
      height={size}
      className={className}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
