import { useTranslation } from 'react-i18next';
import { openExternal } from '@utils/tauriApi';
import './web-page.scss';

/**
 * 在编辑器内展示网页：顶部显示地址与浏览器入口，下方为 iframe。
 * 部分站点会通过 X-Frame-Options 拒绝内嵌，此时用顶部的「浏览器打开」兜底。
 *
 * @param {object} props 组件属性。
 * @param {string} props.url 网页地址。
 * @param {string} [props.className] 额外样式类。
 * @returns {JSX.Element} 网页视图。
 */
export default function WebPageView({ url, className = '' }) {
  const { t } = useTranslation();
  return (
    <div className={`web-page ${className}`}>
      <div className="web-page__bar">
        <span className="web-page__url" title={url}>{url}</span>
        <button
          type="button"
          className="web-page__action"
          onClick={() => { void openExternal(url).catch(() => {}); }}
        >
          {t('web.openInBrowser')}
        </button>
      </div>
      <iframe
        className="web-page__frame"
        src={url}
        title={url}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
