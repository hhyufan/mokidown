import './footer.scss';
import useSteadyStatus from '@hooks/useSteadyStatus';

const Spinner = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
    <path d="M12 3a9 9 0 1 0 9 9" />
  </svg>
);

/**
 * Sync status pill. The host renders whatever the plugin injects:
 * `item.icon` (SVG string), `item.text`, `item.tone`. It only knows how to lay
 * the parts out — the icon set is the plugin's decision.
 */
export default function PluginStatusPill({ item: incoming, onActivate }) {
  const item = useSteadyStatus(incoming);
  return (
    <button
      type="button"
      className={`plugin-status plugin-status--${item.tone || 'info'}${item.busy ? ' is-busy' : ''}`}
      title={item.title || item.text}
      onClick={() => onActivate?.()}
    >
      <span className="plugin-status__icon">
        {item.busy
          ? <Spinner />
          : item.icon
            ? <span dangerouslySetInnerHTML={{ __html: item.icon }} />
            : <span aria-hidden="true">●</span>}
      </span>
      <span key={item.text} className="plugin-status__label">{item.text}</span>
    </button>
  );
}
