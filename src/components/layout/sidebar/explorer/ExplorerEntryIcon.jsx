import FileTypeIcon from '@components/ui/FileTypeIcon';
import { getFolderIconUrl } from '@utils/folderIcons';
import { getFileIconUrl } from '@utils/fileIcons';
import folderDefault from '../../../../assets/file-icons/folder-default.svg?url';
import folderOpen from '../../../../assets/file-icons/folder-default-open.svg?url';
import fileDefault from '../../../../assets/file-icons/file-default.svg?url';

// Scrolling defers tooltips and component-heavy details, never folder colors.
export default function ExplorerEntryIcon({ file, expanded = false, defer = false }) {
  if (!defer) return <FileTypeIcon fileName={file.name} isFolder={file.is_dir} isExpanded={expanded} />;
  const url = file.is_dir ? getFolderIconUrl(file.name, expanded) : getFileIconUrl(file.name);
  return <img src={url || (file.is_dir ? expanded ? folderOpen : folderDefault : fileDefault)} width={16} height={16} alt="" aria-hidden="true" draggable={false} />;
}
