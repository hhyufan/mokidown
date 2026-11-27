import markdownCss from '../components/overlays/snapshot-markdown.scss?inline';
import poppins from '../assets/font/Poppins-Regular.woff2?url';
import poppinsBold from '../assets/font/Poppins-SemiBold.woff2?url';
import poppinsItalic from '../assets/font/Poppins-Italic.woff2?url';
import poppinsBoldItalic from '../assets/font/Poppins-SemiBoldItalic.woff2?url';
import hanSans from '../assets/font/SourceHanSansSC-Regular.woff2?url';
import jetBrains from '../assets/font/JetBrainsMono-VariableFont_wght.woff2?url';
import jetBrainsItalic from '../assets/font/JetBrainsMono-Italic-VariableFont_wght.woff2?url';

const proseFonts = [
  ['Poppins', 400, 'normal', poppins],
  ['Poppins', 600, 'normal', poppinsBold],
  ['Poppins', 400, 'italic', poppinsItalic],
  ['Poppins', 600, 'italic', poppinsBoldItalic],
  ['Source-HanSan', 400, 'normal', hanSans],
];
const codeFonts = [
  ['JetBrains Mono', '100 900', 'normal', jetBrains],
  ['JetBrains Mono', '100 900', 'italic', jetBrainsItalic],
];
const fontDataUrls = new Map();

async function fontDataUrl(url) {
  if (!fontDataUrls.has(url)) {
    const load = fetch(url).then(async (response) => {
      if (!response.ok) throw new Error('Could not read snapshot font');
      const bytes = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(bytes);
      });
    });
    fontDataUrls.set(url, load);
  }
  try {
    return await fontDataUrls.get(url);
  } catch {
    fontDataUrls.delete(url);
    return '';
  }
}

async function embedFont([family, weight, style, url]) {
  const dataUrl = await fontDataUrl(url);
  return dataUrl
    ? `@font-face { font-family: '${family}'; font-weight: ${weight}; font-style: ${style}; src: url("${dataUrl}") format('woff2'); }`
    : '';
}

async function mathStyles() {
  const { default: css } = await import('katex/dist/katex.min.css?inline');
  const fontUrl = /url\(["']?([^"'()]+\.woff2)["']?\)/g;
  const urls = new Set(Array.from(css.matchAll(fontUrl), ([, url]) => url));
  const sources = new Map(
    await Promise.all([...urls].map(async (url) => [url, await fontDataUrl(url)])),
  );
  return css.replace(fontUrl, (original, url) =>
    sources.get(url) ? `url("${sources.get(url)}")` : original,
  );
}

export async function snapshotMarkdownStyles(content) {
  const fonts = content.querySelector('code, pre, kbd')
    ? [...proseFonts, ...codeFonts]
    : proseFonts;
  const [faces, math] = await Promise.all([
    Promise.all(fonts.map(embedFont)),
    content.querySelector('.katex') ? mathStyles() : '',
  ]);
  return `${faces.join('\n')}\n${math}\n*, ::before, ::after { box-sizing: border-box; }\n${markdownCss}`;
}
