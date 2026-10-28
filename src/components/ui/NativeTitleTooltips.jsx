import { useRef } from 'react';
import MilkdownTooltips from '../editor/MilkdownTooltips';

// Third-party controls can generate title attributes after React renders.
// Convert those too, without touching iframe accessible names or document data.
export default function NativeTitleTooltips() {
  const rootRef = useRef(document.body);
  return <MilkdownTooltips rootRef={rootRef} readOnly nativeOnly />;
}
