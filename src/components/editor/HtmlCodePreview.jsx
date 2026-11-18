import { useState } from 'react';
import HtmlPreview from './HtmlPreview';

export default function HtmlCodePreview({ source, filePath }) {
  const [fileName] = useState(() => `html-snippet-${crypto.randomUUID().slice(0, 8)}.html`);
  const separator = Math.max(filePath?.lastIndexOf('/') ?? -1, filePath?.lastIndexOf('\\') ?? -1);
  const previewPath = separator < 0 ? fileName : `${filePath.slice(0, separator + 1)}${fileName}`;
  return <HtmlPreview source={source} filePath={previewPath} compact />;
}
