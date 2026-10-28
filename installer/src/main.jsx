import { createRoot } from 'react-dom/client';
import Installer from './Installer';
import NativeTitleTooltips from '../../src/components/ui/NativeTitleTooltips';

createRoot(document.getElementById('root')).render(<><Installer /><NativeTitleTooltips /></>);
