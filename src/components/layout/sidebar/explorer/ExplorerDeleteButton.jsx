import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';

export default function ExplorerDeleteButton({ file, onClick, defer }) {
  const { t } = useTranslation();
  const label = t(file.is_dir ? 'sidebar.explorer.deleteFolder' : 'sidebar.explorer.deleteFile');
  const button = <button type="button" className="file-tree__item-del" aria-label={label} onClick={onClick}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </svg>
    </button>;
  return defer ? button : <Tooltip title={label} placement="top" mouseEnterDelay={0.3}>{button}</Tooltip>;
}
