import { mountDragPreview } from './dragPreview';

void mountDragPreview().catch((error) => console.error('[reader] Could not initialize drag preview:', error));
