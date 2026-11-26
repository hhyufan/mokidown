import { useCallback, useEffect, useRef, useState } from 'react';
import { Tooltip } from 'antd';
import { GithubOutlined, ReloadOutlined } from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import ChevronIcon from '@components/ui/ChevronIcon';
import useConfigStore from '@store/useConfigStore';
import useEditorStore from '@store/useEditorStore';
import useHistoryStore from '@store/useHistoryStore';
import useNotificationStore from '@store/useNotificationStore';
import { fileName, filePath, githubFileHistoryUrl } from '@utils/gitHistory';
import { formatHistoryTime } from '@utils/historyFormat';
import { isAndroidRuntime } from '@utils/platform';
import { openEditorLink } from '@utils/editorLinks';
import { isMarkdownPath, prepareComparisonRenderer } from '@utils/editorRendererBoot';
import './history.scss';

export default function GitFileTimeline() {
  const { t } = useTranslation();
  const gitPath = useConfigStore((state) => state.gitExecutablePath);
  const tab = useEditorStore((state) => state.tabs.find((item) => item.id === state.activeTabId));
  const tabId = tab?.id;
  const file = tab?.path;
  const eligible = !!(
    window.__TAURI_INTERNALS__ &&
    !isAndroidRuntime() &&
    file &&
    !/^[a-z][a-z\d+.-]*:\/\//i.test(file)
  );
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const request = useRef(0);
  const comparisonRequest = useRef(0);
  const data = loaded?.file === file && loaded?.gitPath === gitPath ? loaded.data : null;
  const online = githubFileHistoryUrl(data?.githubRemote, data?.githubRef, data?.path);

  const notifyError = useCallback(
    (failure) => {
      const code = failure?.message || String(failure);
      useNotificationStore
        .getState()
        .notify(
          'error',
          t('workspaceDiff.fileHistory'),
          t(`workspaceDiff.errors.${code}`, { defaultValue: code }),
        );
    },
    [t],
  );

  const load = useCallback(
    async (offset = 0, interactive = false) => {
      if (!eligible) return;
      const id = ++request.current;
      setLoading(true);
      try {
        const next = await invoke('git_file_history', { file, gitPath, offset });
        if (request.current !== id) return;
        setLoaded((previous) => {
          if (offset && next && previous?.data) {
            const seen = new Set(previous.data.revisions.map((item) => item.hash));
            const revisions = [
              ...previous.data.revisions,
              ...next.revisions.filter((item) => !seen.has(item.hash)),
            ];
            return {
              file,
              gitPath,
              data: { ...next, revisions },
              offset: offset + next.revisions.length,
            };
          }
          return { file, gitPath, data: next, offset: next?.revisions.length || 0 };
        });
      } catch (failure) {
        if (interactive && request.current === id) notifyError(failure);
      } finally {
        if (request.current === id) setLoading(false);
      }
    },
    [eligible, file, gitPath, notifyError],
  );

  const cancelPending = useCallback(() => {
    request.current++;
    comparisonRequest.current++;
  }, []);

  useEffect(() => {
    setLoading(false);
    const timer = setTimeout(() => void load(), 120);
    return () => {
      clearTimeout(timer);
      cancelPending();
    };
  }, [cancelPending, load]);

  const openRevision = async (revision) => {
    prepareComparisonRenderer([revision.previousPath, revision.path].every(isMarkdownPath));
    const id = ++comparisonRequest.current;
    setSelected({ file, hash: revision.hash });
    try {
      const { original, modified } = await invoke('git_compare_revisions', {
        directory: data.root,
        gitPath,
        original: revision.parent,
        modified: revision.hash,
        originalPath: revision.previousPath,
        modifiedPath: revision.path,
      });
      if (id !== comparisonRequest.current || useEditorStore.getState().activeTabId !== tabId)
        return;
      useHistoryStore.getState().openFileComparison(
        tabId,
        original,
        {
          modified,
          repository: data.root,
          originalPath: filePath(data.root, revision.previousPath),
          modifiedPath: filePath(data.root, revision.path),
          originalName: fileName(revision.previousPath),
          modifiedName: fileName(revision.path),
          originalLabel: revision.parent?.slice(0, 8) || '∅',
          modifiedLabel: revision.hash.slice(0, 8),
        },
        revision.subject || t('workspaceDiff.fileHistory'),
      );
    } catch (failure) {
      if (id === comparisonRequest.current) notifyError(failure);
    }
  };

  if (!eligible || !data) return null;
  return (
    <section className={`timeline timeline--git${expanded ? ' timeline--open' : ''}`}>
      <header className="timeline__header">
        <button
          type="button"
          className="timeline__toggle"
          aria-expanded={expanded}
          aria-label={t('workspaceDiff.fileHistory')}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronIcon className="timeline__chevron" />
        </button>
        <span className="timeline__label">{t('workspaceDiff.fileHistory')}</span>
        {online && (
          <Tooltip title={t('workspaceDiff.githubHistory')} placement="top">
            <button
              type="button"
              className="timeline__refresh"
              aria-label={t('workspaceDiff.githubHistory')}
              onClick={() => {
                void openEditorLink(online, { browserFallback: true }).catch(notifyError);
              }}
            >
              <GithubOutlined />
            </button>
          </Tooltip>
        )}
        <span className="timeline__count">
          {data.revisions.length}
          {data.hasMore ? '+' : ''}
        </span>
        <Tooltip title={t('history.refresh')} placement="top">
          <button
            type="button"
            className="timeline__refresh"
            aria-label={t('history.refresh')}
            disabled={loading}
            onClick={() => void load(0, true)}
          >
            <ReloadOutlined spin={loading} />
          </button>
        </Tooltip>
      </header>
      <div
        className="timeline__body"
        aria-hidden={!expanded}
        aria-busy={loading}
        inert={expanded ? undefined : ''}
      >
        <ul className="timeline__list">
          {data.revisions.map((revision) => (
            <li key={revision.hash}>
              <Tooltip
                title={`${revision.subject}\n${revision.author} · ${formatHistoryTime(revision.time)} · ${revision.hash}`}
                placement="top"
              >
                <button
                  type="button"
                  className={`timeline__item${selected?.file === file && selected?.hash === revision.hash ? ' is-selected' : ''}`}
                  onClick={() => void openRevision(revision)}
                >
                  <span className="timeline__git-hash">{revision.hash.slice(0, 8)}</span>
                  <span className="timeline__git-subject">{revision.subject}</span>
                  <time dateTime={revision.time}>{formatHistoryTime(revision.time)}</time>
                </button>
              </Tooltip>
            </li>
          ))}
          {data.hasMore && (
            <li>
              <button
                type="button"
                className="timeline__item"
                disabled={loading}
                onClick={() => void load(loaded.offset, true)}
              >
                {t('workspaceDiff.moreHistory')}
              </button>
            </li>
          )}
          {!data.revisions.length && (
            <li className="timeline__placeholder">{t('workspaceDiff.noGitHistory')}</li>
          )}
        </ul>
      </div>
    </section>
  );
}
