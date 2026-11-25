import { useRef, useState } from 'react';
import { Button, Popover, Tooltip } from 'antd';
import { DiffOutlined, FileOutlined, FolderOpenOutlined, SwapOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/plugin-dialog';
import { isAndroidRuntime } from '@utils/platform';
import { readFileContent } from '@utils/tauriApi';
import { decodeTextBytes, MAX_TEXT_BYTES } from '@utils/textFilePolicy';
import useEditorStore from '@store/useEditorStore';
import useHistoryStore from '@store/useHistoryStore';
import FileTypeIcon from '@components/ui/FileTypeIcon';
import './workspace-changes.scss';

async function readSelection(selection) {
  if (selection.file) {
    if (selection.file.size > MAX_TEXT_BYTES) throw new Error('comparisonTooLarge');
    return decodeTextBytes(new Uint8Array(await selection.file.arrayBuffer())).content;
  }
  const result = await readFileContent(selection.path);
  if (!result.success) throw new Error(result.blockedReason || result.message);
  return result.content ?? '';
}

export default function ManualFileCompare() {
  const { t } = useTranslation();
  const [panelOpen, setPanelOpen] = useState(false);
  const [files, setFiles] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputs = useRef({});
  const desktop = Boolean(window.__TAURI_INTERNALS__) && !isAndroidRuntime();
  const title = t('workspaceDiff.manual');

  const select = (side, file) => {
    setError('');
    setFiles((previous) => ({ ...previous, [side]: file }));
  };
  const reportError = (failure) => {
    const code = failure?.kind ?? failure?.message ?? String(failure);
    setError(t(`workspaceDiff.errors.${code}`, { defaultValue: code }));
  };
  const pick = async (side) => {
    try {
      const path = await open({ multiple: false });
      if (typeof path === 'string') select(side, { path, name: path.split(/[\\/]/).at(-1) });
    } catch (failure) {
      reportError(failure);
    }
  };
  const compare = async () => {
    const { left, right } = files;
    const tabId = useEditorStore.getState().activeTabId;
    setError('');
    setBusy(true);
    try {
      const [original, modified] = await Promise.all([readSelection(left), readSelection(right)]);
      if (useEditorStore.getState().activeTabId !== tabId) return;
      useHistoryStore.getState().openFileComparison(
        tabId,
        original,
        {
          modified,
          originalPath: left.path,
          modifiedPath: right.path,
          originalName: left.name,
          modifiedName: right.name,
        },
        title,
      );
      setPanelOpen(false);
    } catch (failure) {
      reportError(failure);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover
      trigger="click"
      placement="bottomLeft"
      arrow={false}
      classNames={{ root: 'workspace-compare-popup' }}
      open={panelOpen}
      onOpenChange={setPanelOpen}
      title={title}
      content={
        <div className="workspace-compare-picker">
          {['left', 'right'].map((side) => (
            <div className="workspace-compare-picker__row" key={side}>
              <div className="workspace-compare-picker__file" title={files[side]?.path}>
                {files[side] ? (
                  <FileTypeIcon fileName={files[side].name} size={16} />
                ) : (
                  <FileOutlined />
                )}
                <div>
                  <small>{t(`workspaceDiff.${side}`)}</small>
                  {files[side] && <span>{files[side].name}</span>}
                </div>
              </div>
              <Tooltip title={t('workspaceDiff.selectFile')}>
                <Button
                  type="text"
                  size="small"
                  icon={<FolderOpenOutlined />}
                  disabled={busy}
                  onClick={() => {
                    if (desktop) void pick(side);
                    else inputs.current[side]?.click();
                  }}
                  aria-label={`${t('workspaceDiff.selectFile')} · ${t(`workspaceDiff.${side}`)}`}
                />
              </Tooltip>
              {!desktop && (
                <input
                  hidden
                  ref={(input) => {
                    inputs.current[side] = input;
                  }}
                  type="file"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) select(side, { path: file.name, name: file.name, file });
                    event.target.value = '';
                  }}
                />
              )}
            </div>
          ))}
          {error && (
            <div className="workspace-changes__error" role="alert">
              {error}
            </div>
          )}
          <div className="workspace-compare-picker__actions">
            <Tooltip title={t('workspaceDiff.swapSides')}>
              <span>
                <Button
                  type="text"
                  size="small"
                  icon={<SwapOutlined />}
                  aria-label={t('workspaceDiff.swapSides')}
                  disabled={busy || (!files.left && !files.right)}
                  onClick={() => setFiles(({ left, right }) => ({ left: right, right: left }))}
                />
              </span>
            </Tooltip>
            <Tooltip title={t('workspaceDiff.compare')}>
              <span>
                <Button
                  type="primary"
                  size="small"
                  icon={<DiffOutlined />}
                  aria-label={t('workspaceDiff.compare')}
                  loading={busy}
                  disabled={!files.left || !files.right}
                  onClick={() => void compare()}
                />
              </span>
            </Tooltip>
          </div>
        </div>
      }
    >
      <button
        type="button"
        className="stb"
        aria-label={title}
        title={title}
        aria-expanded={panelOpen}
      >
        <DiffOutlined />
      </button>
    </Popover>
  );
}
