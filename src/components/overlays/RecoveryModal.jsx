import AppDialog from './AppDialog';
import { lazy, Suspense, useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Space, Typography } from 'antd';
import i18n from '@/i18n';
import { useTranslation } from 'react-i18next';
import useThemeStore from '@store/useThemeStore';
import useConfigStore from '@store/useConfigStore';
import './external-file-conflict.scss';
import './recovery-modal.scss';

const MonacoConflictDiff = lazy(() => import('./MonacoConflictDiff'));

const { Paragraph } = Typography;

function RecoveryModal({ open, drafts, onRestore, onDiscard }) {
  useTranslation();
  const theme = useThemeStore((state) => state.theme);
  const { fontSize, fontFamily, lineHeight, tabSize } = useConfigStore();
  const [selected, setSelected] = useState(() => new Set(drafts.map((draft) => draft.recoveryId)));
  const [previewId, setPreviewId] = useState(drafts[0]?.recoveryId);
  const preview = drafts.find((draft) => draft.recoveryId === previewId) || drafts[0];
  const selectedDrafts = useMemo(
    () => drafts.filter((draft) => selected.has(draft.recoveryId)),
    [drafts, selected],
  );

  const toggle = (id, checked) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  return (
    <AppDialog
      open={open}
      closable={false}
      maskClosable={false}
      keyboard={false}
      width="min(1180px, 94vw)"
      rootClassName="moki-recovery-root"
      destroyOnHidden
      title={i18n.t('unsaved.recoveryTitle')}
      footer={(
        <Space>
          <Button danger onClick={onDiscard}>{i18n.t('unsaved.discardAll')}</Button>
          <Button
            type="primary"
            disabled={selectedDrafts.length === 0}
            onClick={() => onRestore(selectedDrafts)}
          >
            {i18n.t('unsaved.restoreSelected', { count: selectedDrafts.length })}
          </Button>
        </Space>
      )}
    >
      <Alert
        type="warning"
        showIcon
        message={i18n.t('unsaved.recoveryMessage')}
        description={i18n.t('unsaved.recoveryHint')}
      />
      <div className="recovery-modal__workspace">
      <div className="recovery-modal__list" role="group" aria-label={i18n.t('unsaved.draftList')}>
        {drafts.map((draft) => (
          <div key={draft.recoveryId} className={`recovery-modal__draft${preview?.recoveryId === draft.recoveryId ? ' recovery-modal__draft--active' : ''}`}>
            <Checkbox
              checked={selected.has(draft.recoveryId)}
              aria-label={i18n.t('unsaved.selectDraft', { name: draft.name })}
              onChange={(event) => toggle(draft.recoveryId, event.target.checked)}
            />
            <button type="button" className="recovery-modal__file" aria-pressed={preview?.recoveryId === draft.recoveryId} onClick={() => setPreviewId(draft.recoveryId)}>
              <span className="recovery-modal__name">{draft.name}</span>
              <span className="recovery-modal__location">{draft.path || i18n.t('unsaved.untitled')}</span>
            </button>
          </div>
        ))}
      </div>
      {preview && <section className="recovery-modal__comparison" aria-label={i18n.t('unsaved.compareDraft')}>
        <Paragraph className="recovery-modal__path" ellipsis={{ rows: 1 }}>
          {preview.path || i18n.t('unsaved.untitled')}
        </Paragraph>
        <div className="recovery-modal__state">{!preview.path ? i18n.t('unsaved.noDiskFile')
          : preview.diskState === 'changed' ? i18n.t('unsaved.diskChanged')
            : preview.diskState === 'blocked' ? i18n.t('unsaved.diskBlocked')
              : preview.diskState === 'missing' ? i18n.t('unsaved.diskMissing') : i18n.t('unsaved.diskUnchanged')}</div>
        <div className="conflict-dialog__diff recovery-modal__diff">
          <Suspense fallback={<div className="recovery-modal__loading" role="status">{i18n.t('editor.loading')}</div>}>
            <MonacoConflictDiff
              original={preview.diskContent || ''}
              modified={preview.content || ''}
              fileName={preview.path || preview.name}
              localLabel={typeof preview.diskContent === 'string' ? i18n.t('sync.conflict.remote') : i18n.t('unsaved.noDiskContent')}
              remoteLabel={i18n.t('unsaved.recoveredContent')}
              theme={theme} fontSize={fontSize} fontFamily={fontFamily} lineHeight={lineHeight} tabSize={tabSize}
            />
          </Suspense>
        </div>
      </section>}
      </div>
    </AppDialog>
  );
}

export default RecoveryModal;
