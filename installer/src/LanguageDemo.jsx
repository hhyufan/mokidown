import i18n from '../../src/i18n';
import { useEffect, useState } from 'react';
import { FileTextOutlined, CheckCircleOutlined } from '@ant-design/icons';
import useDemoComplete from './useDemoComplete';

// A local language-service demonstration; no server or document access in setup.
export default function LanguageDemo({ onComplete }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setStep(2);
      return undefined;
    }
    let timers = [];
    const run = () => {
      setStep(0);
      timers = [
        setTimeout(() => setStep(1), 1400),
        setTimeout(() => setStep(2), 4300),
        setTimeout(run, 5800),
      ];
    };
    run();
    return () => timers.forEach(clearTimeout);
  }, []);
  useDemoComplete(step === 2, onComplete);
  return (
    <div
      className="scene-language-demo"
      data-complete={step === 2}
      aria-label={i18n.t('installer.linkDemo')}
    >
      <div className="scene-language-source">
        <div>
          <span className="scene-line-number">1</span>
          <span className="scene-token-heading"># 我的阅读清单</span>
        </div>
        <div>
          <span className="scene-line-number">2</span>
        </div>
        <div>
          <span className="scene-line-number">3</span>
          <span>
            继续阅读 <span className="scene-link-text">[阅读笔记]</span>(
            <span className={step === 0 ? 'scene-link-diagnostic' : 'scene-link-path'}>
              {step === 2 ? './notes.md' : './no'}
            </span>
            {step === 2 ? ')' : <i className="scene-typing-caret" />}
          </span>
        </div>
      </div>
      {step < 2 && (
        <div className={`scene-completions${step === 0 ? ' is-waiting' : ''}`}>
          <div className="scene-completion-row is-selected">
            <FileTextOutlined />
            <span>
              <b>no</b>tes.md
            </span>
            <small>{i18n.t('installer.document')}</small>
          </div>
          <div className="scene-completion-row">
            <FileTextOutlined />
            <span>
              <b>no</b>tebook.md
            </span>
            <small>{i18n.t('installer.document')}</small>
          </div>
          <div className="scene-completion-detail">
            阅读笔记 <span>Enter ↵</span>
          </div>
        </div>
      )}
      <div className={`scene-language-message${step === 2 ? ' is-resolved' : ''}`}>
        {step === 2 ? (
          <>
            <CheckCircleOutlined />
            <span>{i18n.t('installer.linkComplete')}</span>
          </>
        ) : step === 1 ? (
          <>
            <FileTextOutlined />
            <span>{i18n.t('installer.selectDocument')}</span>
          </>
        ) : (
          <>
            <span className="scene-diagnostic-dot" />
            <span>{i18n.t('installer.checkReferences')}</span>
          </>
        )}
      </div>
      <div className="scene-editor-footer">
        <span>{i18n.t('installer.languageFooter')}</span>
        <span>UTF-8 · LF</span>
      </div>
    </div>
  );
}
