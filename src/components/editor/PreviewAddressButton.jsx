import './preview-address.scss';

const drawings = {
  refresh: 'M23 4v6h-6 M20.49 15a9 9 0 1 1-2.12-9.36L23 10',
  close: 'M18 6 6 18 M6 6l12 12',
  copy: 'M16 4H6a2 2 0 0 0-2 2v10 M10 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z',
  move: 'M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4',
  external: 'M13 5h6v6m0-6-8 8 M10 6H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-3',
};

export default function PreviewAddressButton({ icon, label, onClick }) {
  return (
    <button type="button" className={`preview-address__button preview-address__button--${icon}`}
      aria-label={label} onClick={onClick}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d={drawings[icon]} />
      </svg>
    </button>
  );
}
