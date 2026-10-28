import { Tooltip } from 'antd';
import i18n from '../../src/i18n';
import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import wordmark from '../../src/assets/mokidown-wordmark.webp';
import FeatureScenes from './FeatureScenes';
import './installer.css';
import './scrollbar.css';

const getScenes = () => [
  {
    label: 'WYSIWYG',
    title: (
      <>
        {i18n.t('installer.writeMoment')}
        <br />
        <em>{i18n.t('installer.becomeArticle')}</em>
      </>
    ),
    description: (
      <>
        {i18n.t('installer.markdownInput')}
        <br />
        {i18n.t('installer.formatAsYouWrite')}
      </>
    ),
  },
  {
    label: 'WRITE',
    title: (
      <>
        {i18n.t('installer.seeAsYouWrite')}
        <br />
        <em>{i18n.t('installer.focusIdeas')}</em>
      </>
    ),
    description: (
      <>
        {i18n.t('installer.sideBySide')}
        <br />
        {i18n.t('installer.firstLine')}
      </>
    ),
  },
  {
    label: 'LANGUAGE',
    title: (
      <>
        {i18n.t('installer.writingDetails')}
        <br />
        <em>{i18n.t('installer.helpAtHand')}</em>
      </>
    ),
    description: (
      <>
        {i18n.t('installer.languageHelp')}
        <br />
        {i18n.t('installer.connectDocuments')}
      </>
    ),
  },
  {
    label: 'PERSONALIZE',
    title: (
      <>
        {i18n.t('installer.dayOrNight')}
        <br />
        <em>{i18n.t('installer.justRight')}</em>
      </>
    ),
    description: (
      <>
        {i18n.t('installer.customize')}
        <br />
        {i18n.t('installer.yourSpace')}
      </>
    ),
  },
  {
    label: 'ORGANIZE',
    title: (
      <>
        {i18n.t('installer.scatteredIdeas')}
        <br />
        <em>{i18n.t('installer.buildKnowledge')}</em>
      </>
    ),
    description: (
      <>
        {i18n.t('installer.organizeNotes')}
        <br />
        {i18n.t('installer.traceIdeas')}
      </>
    ),
  },
];
const getStages = () => ({
  ready: i18n.t('installer.ready'),
  preparing: i18n.t('installer.preparing'),
  runtime: i18n.t('installer.runtime'),
  copying: i18n.t('installer.copying'),
  registering: i18n.t('installer.registering'),
  shortcuts: i18n.t('installer.shortcuts'),
  complete: i18n.t('installer.complete'),
  error: i18n.t('installer.error'),
});

export default function Installer() {
  useTranslation();
  const scenes = getScenes();
  const stages = getStages();
  const native = isTauri();
  const [slide, setSlide] = useState(0);
  const nextSlideTimer = useRef(null);
  const handleSceneComplete = useCallback((finishedSlide) => {
    // Static accessibility demos stay under manual navigation.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    clearTimeout(nextSlideTimer.current);
    nextSlideTimer.current = setTimeout(() => {
      setSlide((current) => (current === finishedSlide ? (current + 1) % getScenes().length : current));
    }, 1000);
  }, []);
  const [directory, setDirectory] = useState('');
  // 被更新器拉起来时（命令行带 /UPDATE）走更新流程：目录由注册表决定，用户不能改。
  const [update, setUpdate] = useState(false);
  const [status, setStatus] = useState({ stage: 'ready', percent: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [demoRunning, setDemoRunning] = useState(false);
  const done = status.stage === 'complete';
  useEffect(() => {
    if (!native) {
      setDirectory('C:\\Users\\you\\AppData\\Local\\MokiDown');
      return;
    }
    invoke('startup_info')
      .then((info) => {
        setDirectory(info.directory);
        setUpdate(Boolean(info.update));
      })
      .catch((e) => setError(String(e)));
    let disposed = false,
      unlisten;
    listen('install-progress', ({ payload }) => {
      if (!disposed) setStatus(payload);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [native]);
  useEffect(() => {
    return () => clearTimeout(nextSlideTimer.current);
  }, [slide]);
  useEffect(() => {
    if (!demoRunning) return;
    const events = [
      { stage: 'preparing', percent: 5 },
      { stage: 'runtime', percent: 12 },
      { stage: 'copying', percent: 25 },
      { stage: 'copying', percent: 57 },
      { stage: 'registering', percent: 78 },
      { stage: 'shortcuts', percent: 94 },
      { stage: 'complete', percent: 100 },
    ];
    const timers = events.map((event, index) =>
      setTimeout(() => {
        setStatus(event);
        if (event.stage === 'complete') {
          setBusy(false);
          setDemoRunning(false);
        }
      }, index * 1400),
    );
    return () => timers.forEach(clearTimeout);
  }, [demoRunning]);
  async function chooseDirectory() {
    if (busy) return;
    if (!native) {
      setShowNotes(true);
      return;
    }
    try {
      const path = await open({ directory: true, multiple: false, title: i18n.t('installer.chooseDirectory') });
      if (path) setDirectory(path);
    } catch (e) {
      setError(String(e));
    }
  }
  async function install() {
    if (busy) return;
    setError('');
    setBusy(true);
    setStatus({ stage: 'preparing', percent: 0 });
    if (!native) {
      setDemoRunning(true);
      return;
    }
    try {
      await invoke('install_application', { directory });
      setStatus({ stage: 'complete', percent: 100 });
    } catch (e) {
      setError(String(e));
      setStatus((s) => ({ ...s, stage: 'error' }));
    } finally {
      setBusy(false);
    }
  }
  async function launch() {
    try {
      // 更新流程装完直接把应用拉起来，并告诉它「刚更新过」——主程序据此跳过
      // 原生启动动画，改播工作区入场动画。
      await invoke('launch_application', { afterUpdate: update });
      await getCurrentWindow().close();
    } catch (e) {
      setError(String(e));
    }
  }
  /*
   * 更新流程全自动：不设按钮，进入即开始安装，装完自动拉起应用并关掉本窗口。
   * 首次安装只保留开始按钮；首次安装和更新完成后都自动进入软件。
   */
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!update || !native || autoStartedRef.current) return;
    if (!directory || busy || done || error) return;
    autoStartedRef.current = true;
    void install();
    // install/launch 是每次渲染重建的普通函数，这里只以状态为触发条件
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update, native, directory, busy, done, error]);
  useEffect(() => {
    if (!native || !done || error) return undefined;
    // 稍留一拍让完成态画出来，再交棒给应用
    const timer = setTimeout(() => {
      void launch();
    }, 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, done, error]);
  function close() {
    if (busy) {
      setConfirmClose(true);
      return;
    }
    if (native) void getCurrentWindow().close();
    else setShowNotes(true);
  }
  return (
    <main className={`installer ${busy ? 'is-installing' : ''} ${done ? 'is-done' : ''}`}>
      <div className="titlebar" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region>
          <img className="brand-wordmark" src={wordmark} alt="MokiDown" />
          <span>{i18n.t('installer.label')}</span>
        </div>
        <div className="window-actions">
          <Tooltip title={i18n.t('installer.minimize')} mouseEnterDelay={0.3}><button  aria-label={i18n.t('installer.minimize')} onClick={() => native && getCurrentWindow().minimize()}>
            −
          </button></Tooltip>
          <Tooltip title={i18n.t('installer.close')} mouseEnterDelay={0.3}><button  aria-label={i18n.t('installer.close')} onClick={close}>
            ×
          </button></Tooltip>
        </div>
      </div>
      <section className="feature" aria-label={i18n.t('installer.features')}>
        {scenes.map((scene, index) => (
          <div
            key={scene.label}
            className={`copy${slide === index ? ' is-visible' : ''}`}
            aria-hidden={slide !== index}
          >
            <div className="eyebrow">
              0{index + 1} / {scene.label}
            </div>
            <h1>
              {done ? (
                <>
                  {i18n.t('installer.allReady')}
                  <br />
                  <em>{i18n.t('installer.newCreation')}</em>
                </>
              ) : (
                scene.title
              )}
            </h1>
            <p className="description">
              {done ? i18n.t('installer.workspaceReady') : scene.description}
            </p>
          </div>
        ))}
        <div className="stage">
          {scenes.map((scene, index) => (
            <div
              key={scene.label}
              className={`card-motion${slide === index ? ' is-visible' : ''}`}
              aria-hidden={slide !== index}
            >
              <FeatureScenes
                slide={index}
                active={slide === index}
                onComplete={handleSceneComplete}
              />
            </div>
          ))}
          {scenes.map((scene, index) => (
            <div
              key={`mascot-${scene.label}`}
              className={`mascot mascot--${[3, 0, 4, 1, 2][index]}${slide === index ? ' is-visible' : ''}`}
              aria-hidden={slide !== index}
              role="img"
              aria-label={
                [
                  i18n.t('installer.mokiRichText'),
                  i18n.t('installer.mokiWrite'),
                  i18n.t('installer.mokiLanguage'),
                  i18n.t('installer.mokiTheme'),
                  i18n.t('installer.mokiOrganize'),
                ][index]
              }
            />
          ))}
        </div>
        <nav className="dots" aria-label={i18n.t('installer.switchFeature')}>
          {scenes.map((scene, index) => (
            <Tooltip key={scene.label} title={i18n.t('installer.featureSlide', { number: index + 1 })} mouseEnterDelay={0.3}><button

              aria-label={i18n.t('installer.featureSlide', { number: index + 1 })}

              aria-pressed={slide === index}
              className={`dot ${slide === index ? 'active' : ''}`}
              onClick={() => setSlide(index)}
            >
              <i aria-hidden="true" />
            </button></Tooltip>
          ))}
        </nav>
      </section>
      <footer className="install-panel">
        {native ? null : <div className="preview-badge">{i18n.t('installer.previewNotice')}</div>}
        <div className="status-row" role="status">
          <span className="status-dot" />
          <strong>
            {done
              ? update
                ? i18n.t('installer.updatedWelcome')
                : i18n.t('installer.welcome')
              : busy
                ? stages[status.stage]
                : update
                  ? i18n.t('installer.prepareUpdate')
                  : i18n.t('installer.nextIdea')}
          </strong>
          <span className="percentage">
            {busy || done ? `${Math.round(status.percent)}%` : 'READY WHEN YOU ARE'}
          </span>
        </div>
        <div
          className="progress"
          role="progressbar"
          aria-label={i18n.t('installer.stageProgress')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={status.percent}
        >
          <div className="progress-fill" style={{ width: `${status.percent}%` }}>
            <i className="progress-shimmer" />
            {status.percent > 0 && <i className="progress-tip" />}
          </div>
        </div>
        {/* 路径行只在还没开始安装时出现。安装中/完成后的进度由上面的状态行与进度条
            表达，不再额外摆一条「准备/安装/配置/完成」——完成页上它是纯噪音。 */}
        {!busy && !done && (
          <div className="path-row">
            <svg
              className="folder-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
            <label htmlFor="install-path">{update ? i18n.t('installer.updateLocation') : i18n.t('installer.installLocation')}</label>
            <input
              id="install-path"
              value={directory}
              readOnly={update}
              onChange={(event) => setDirectory(event.target.value)}
              spellCheck={false}
            />
            {/* 更新时目录来自注册表里上次的安装位置，不让改——改了会装出第二份 */}
            {update ? null : (
              <button className="text-button" onClick={chooseDirectory}>
                <span>{i18n.t('installer.change')}</span>
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m7.5 5 5 5-5 5" />
                </svg>
              </button>
            )}
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          {(done || busy || update) && (
            <p>
              {done
                ? update
                  ? i18n.t('installer.launchUpdated')
                  : i18n.t('installer.launchInstalled')
                : busy
                  ? update
                    ? i18n.t('installer.updating')
                    : i18n.t('installer.installingHelp')
                  : update
                    ? i18n.t('installer.preserveSettings')
                    : ''}
            </p>
          )}
          {error ? (
            <button className="primary" onClick={install}>
              {i18n.t('installer.retry')}
            </button>
          ) : (
            !update &&
            !done && (
              <button className="primary" disabled={busy || !directory} onClick={install}>
                {busy ? (
                  <>
                    <i className="button-spinner" />
                    {i18n.t('installer.installing')}
                  </>
                ) : (
                  i18n.t('installer.start')
                )}
              </button>
            )
          )}
        </div>
      </footer>
      {(confirmClose || showNotes) && (
        <div className="dialog-backdrop">
          <div className="dialog" role="dialog" aria-modal="true">
            <h2>{confirmClose ? i18n.t('installer.inProgress') : i18n.t('installer.previewTitle')}</h2>
            <p>
              {confirmClose
                ? i18n.t('installer.wait')
                : i18n.t('installer.previewHelp')}
            </p>
            <button
              className="primary"
              onClick={() => {
                setConfirmClose(false);
                setShowNotes(false);
              }}
            >
              {i18n.t('installer.understood')}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
