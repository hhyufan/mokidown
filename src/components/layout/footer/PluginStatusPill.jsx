import './footer.scss';

const CloudIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
  </svg>
);
const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const AlertIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);
const CloudOffIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22.61 16.95A5 5 0 0 0 18 10h-1.26a8 8 0 0 0-7.05-6M5 5a8 8 0 0 0 4 15h9a5 5 0 0 0 1.7-.3" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);
/** Standard loading spinner: a partial ring that rotates. */
const SpinnerIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
    <path d="M12 3a9 9 0 1 0 9 9" />
  </svg>
);

/**
 * Status-only pill for service plugins: no dropdown, a click runs the
 * plugin's sync command. The spinner is a regular loading ring, not a
 * rotating cloud.
 */
export default function PluginStatusPill({ item, onActivate }) {
  const tone = item.tone || 'info';
  const Icon = tone === 'success'
    ? CheckIcon
    : tone === 'error'
      ? AlertIcon
      : tone === 'warning'
        ? CloudOffIcon
        : item.busy
          ? SpinnerIcon
          : CloudIcon;
  return (
    <button
      type="button"
      className={`plugin-status plugin-status--${tone}${item.busy ? ' is-busy' : ''}`}
      title={item.title || item.text}
      onClick={() => onActivate?.()}
    >
      <span className="plugin-status__icon"><Icon /></span>
      <span className="plugin-status__label">{item.text}</span>
    </button>
  );
}
