import { createRoot } from 'react-dom/client';
import FeatureSections from './FeatureSections';
import './site.css';

// The hero preview is the real application in an iframe; this bundle only
// renders the five feature sections, which reuse the installer's components.
for (const host of document.querySelectorAll('[data-moki-features]')) {
  createRoot(host).render(<FeatureSections />);
}
