import { useState } from 'react';
import { Input } from 'antd';
import { useTranslation } from 'react-i18next';
import FileTypeIcon from '@components/ui/FileTypeIcon';
import AppDialog from './AppDialog';
import './file-drop-conflict.scss';

export default function FileDropConflict({ source, path, resolve }) {
  const { t } = useTranslation();
  const [name, setName] = useState(() => {
    const original = path.split(/[\\/]/).pop();
    const dot = original.lastIndexOf('.');
    return dot > 0 ? `${original.slice(0, dot)} (2)${original.slice(dot)}` : `${original} (2)`;
  });
  const sourceName = source.split(/[\\/]/).pop();
  const dot = sourceName.lastIndexOf('.');
  const extension = dot > 0 ? sourceName.slice(dot + 1) : '';
  const valid = name.trim() && !/[\\/:*?"<>|]/.test(name) && !/[. ]$/.test(name)
    && Array.from(name).every((character) => character.charCodeAt(0) >= 32);
  const submit = () => { if (valid) resolve(name.trim()); };
  return <AppDialog open title={t('drag.conflictTitle')} okText={t('drag.keepBoth')} cancelText={t('drag.skip')}
    width={420} rootClassName="file-drop-conflict"
    onOk={submit} onCancel={() => resolve(null)} okButtonProps={{ disabled: !valid }}>
    <p className="file-drop-conflict__hint">{t('drag.conflictDetails')}</p>
    <div className="file-drop-conflict__row">
      <FileTypeIcon fileName={sourceName} extension={extension} size={18} />
      <Input className="file-drop-conflict__input" autoFocus value={name} aria-label={t('drag.newName')}
        onChange={(event) => setName(event.target.value)}
        onPressEnter={(event) => { if (!event.nativeEvent.isComposing) submit(); }} />
    </div>
  </AppDialog>;
}
