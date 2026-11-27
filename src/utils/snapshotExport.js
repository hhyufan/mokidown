import { invoke } from '@utils/tauriInvoke';
import { DARK_THEME_NAME, LIGHT_THEME_NAME, prepareMonacoHighlighting } from './monacoShikiAssets';

export const SNAPSHOT_BACKDROPS = [
  {
    id: 'vitality',
    labelKey: 'snapshot.backdrop.vitality',
    angle: 135,
    light: [
      [0, '#dbeafe'],
      [0.52, '#93c5fd'],
      [1, '#4091ff'],
    ],
    dark: [
      [0, '#0c1b3a'],
      [0.52, '#1a3a7a'],
      [1, '#2563eb'],
    ],
  },
  {
    id: 'daybreak',
    labelKey: 'snapshot.backdrop.daybreak',
    angle: 135,
    light: [
      [0, '#fef3c7'],
      [0.5, '#fdba74'],
      [1, '#f472b6'],
    ],
    dark: [
      [0, '#431407'],
      [0.5, '#9a3412'],
      [1, '#be185d'],
    ],
  },
  {
    id: 'starlight',
    labelKey: 'snapshot.backdrop.starlight',
    angle: 135,
    light: [
      [0, '#c7d2fe'],
      [0.52, '#818cf8'],
      [1, '#4338ca'],
    ],
    dark: [
      [0, '#0f172a'],
      [0.55, '#312e81'],
      [1, '#1d4ed8'],
    ],
  },
  {
    id: 'mint',
    labelKey: 'snapshot.backdrop.mint',
    angle: 135,
    light: [
      [0, '#ccfbf1'],
      [0.5, '#5eead4'],
      [1, '#38bdf8'],
    ],
    dark: [
      [0, '#042f2e'],
      [0.52, '#0f766e'],
      [1, '#0369a1'],
    ],
  },
  {
    id: 'sakura',
    labelKey: 'snapshot.backdrop.sakura',
    angle: 135,
    light: [
      [0, '#fce7f3'],
      [0.52, '#e9d5ff'],
      [1, '#bfdbfe'],
    ],
    dark: [
      [0, '#4a044e'],
      [0.52, '#581c87'],
      [1, '#1e3a8a'],
    ],
  },
  {
    id: 'minimal',
    labelKey: 'snapshot.backdrop.minimal',
    angle: 135,
    light: [
      [0, '#eef0f4'],
      [1, '#dfe4ec'],
    ],
    dark: [
      [0, '#16181d'],
      [1, '#252831'],
    ],
  },
  {
    id: 'transparent',
    labelKey: 'snapshot.backdrop.transparent',
    angle: 135,
    light: null,
    dark: null,
  },
  {
    id: 'none',
    labelKey: 'snapshot.backdrop.none',
    light: null,
    dark: null,
  },
];

export function getSnapshotFramePadding(backdrop, padding) {
  return backdrop === 'none' ? 0 : Math.max(0, Math.min(80, Number(padding) || 0));
}

export const SNAPSHOT_MARKDOWN_INSET = 29;

export function snapshotMarkdownVariables(palette) {
  return {
    '--snap-surface': palette.surface,
    '--snap-header-bg': palette.headerBg,
    '--snap-header-border': palette.headerBorder,
    '--snap-border': palette.border,
    '--snap-text': palette.text,
    '--snap-heading': palette.heading,
    '--snap-muted': palette.muted,
    '--snap-accent': palette.accent,
    '--snap-accent-bg': palette.accentBg,
    '--snap-code-bg': palette.codeBg,
    '--snap-inline-code-bg': palette.inlineCodeBg,
    '--snap-quote-bg': palette.quoteBg,
    '--snap-rule': palette.rule,
    '--snap-table-head': palette.tableHeadBg,
    '--snap-table-alt': palette.tableRowAlt,
    '--snap-watermark-text': palette.watermarkText,
  };
}

export const SNAPSHOT_RAINBOW_COLORS_LIGHT = [
  'rgba(255, 255, 64, 0.1)',
  'rgba(127, 255, 127, 0.1)',
  'rgba(255, 127, 255, 0.1)',
  'rgba(79, 236, 236, 0.1)',
];

export const SNAPSHOT_RAINBOW_COLORS_DARK = [
  'rgba(255, 255, 64, 0.12)',
  'rgba(127, 255, 127, 0.12)',
  'rgba(255, 127, 255, 0.12)',
  'rgba(79, 236, 236, 0.12)',
];

/**
 * 计算每行前导缩进宽度（单位：字符列数），规则与编辑器内彩虹缩进保持一致。
 */
export function computeIndentRainbowWidths(lines, tabSize = 2) {
  const step = Math.max(1, Number(tabSize) || 2);
  const parsed = (lines || []).map((raw) => {
    const text = String(raw || '');
    let width = 0;
    let cursor = 0;
    while (cursor < text.length && (text[cursor] === ' ' || text[cursor] === '\t')) {
      width += text[cursor] === '\t' ? step - (width % step) : 1;
      cursor++;
    }
    return { width, trimmed: Boolean(text.trim()) };
  });

  const nextWidths = new Array(parsed.length).fill(null);
  let nextWidth = null;
  for (let i = parsed.length - 1; i >= 0; i--) {
    if (parsed[i].trimmed) nextWidth = parsed[i].width;
    nextWidths[i] = nextWidth;
  }

  const result = new Array(parsed.length).fill(0);
  let previousWidth = null;
  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    if (item.trimmed) {
      previousWidth = item.width;
      result[i] = item.width;
      continue;
    }
    result[i] = item.width ? item.width : (nextWidths[i] ?? previousWidth ?? 0);
  }
  return result;
}

export function getBackdropPreset(id) {
  return SNAPSHOT_BACKDROPS.find((item) => item.id === id) || SNAPSHOT_BACKDROPS[0];
}

export function backdropCssGradient(id, dark) {
  const preset = getBackdropPreset(id);
  const stops = dark ? preset.dark : preset.light;
  if (!stops) return 'none';
  return `linear-gradient(${preset.angle}deg, ${stops
    .map(([offset, color]) => `${color} ${Math.round(offset * 100)}%`)
    .join(', ')})`;
}

export function getCardPalette(dark, hasAppBackground = false) {
  if (dark) {
    return {
      dark: true,
      surface: hasAppBackground ? '#181818' : '#1e2026',
      headerBg: hasAppBackground ? 'rgba(24, 24, 24, 0.48)' : '#181a20',
      headerBorder: 'rgba(255, 255, 255, 0.08)',
      border: 'rgba(255, 255, 255, 0.11)',
      highlight: 'rgba(255, 255, 255, 0.08)',
      text: '#abb2bf',
      heading: '#f5f5f7',
      muted: '#636b78',
      accent: '#5a9fff',
      accentBg: 'rgba(90, 159, 255, 0.15)',
      codeBg: 'rgba(255, 255, 255, 0.06)',
      inlineCodeBg: 'rgba(90, 159, 255, 0.16)',
      quoteBg: 'rgba(90, 159, 255, 0.12)',
      rule: 'rgba(245, 245, 247, 0.14)',
      tableHeadBg: 'rgba(90, 159, 255, 0.16)',
      tableRowAlt: 'rgba(90, 159, 255, 0.06)',
      watermarkBg: 'rgba(255, 255, 255, 0.06)',
      watermarkText: 'rgba(245, 245, 247, 0.56)',
    };
  }
  return {
    dark: false,
    surface: '#ffffff',
    headerBg: hasAppBackground ? 'rgba(255, 255, 255, 0.52)' : '#f8fafd',
    headerBorder: 'rgba(15, 23, 42, 0.07)',
    border: 'rgba(15, 23, 42, 0.09)',
    highlight: 'rgba(255, 255, 255, 0.9)',
    text: '#383a42',
    heading: '#1f2329',
    muted: '#9ca3af',
    accent: '#4091ff',
    accentBg: 'rgba(64, 145, 255, 0.10)',
    codeBg: 'rgba(64, 145, 255, 0.055)',
    inlineCodeBg: 'rgba(168, 201, 255, 0.24)',
    quoteBg: 'rgba(168, 201, 255, 0.18)',
    rule: 'rgba(44, 44, 46, 0.12)',
    tableHeadBg: 'rgba(168, 201, 255, 0.22)',
    tableRowAlt: 'rgba(168, 201, 255, 0.09)',
    watermarkBg: 'rgba(15, 23, 42, 0.045)',
    watermarkText: 'rgba(44, 44, 46, 0.48)',
  };
}

const LANGUAGE_ALIASES = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  yml: 'yaml',
  md: 'markdown',
  cs: 'csharp',
  'c#': 'csharp',
  rb: 'ruby',
  rs: 'rust',
  kt: 'kotlin',
  ps1: 'powershell',
  htm: 'html',
  svg: 'xml',
  jsonc: 'json',
};

const LANGUAGE_LABELS = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  markdown: 'Markdown',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  json: 'JSON',
  yaml: 'YAML',
  xml: 'XML',
  sql: 'SQL',
  shell: 'Shell',
  powershell: 'PowerShell',
  csharp: 'C#',
  cpp: 'C++',
  c: 'C',
  java: 'Java',
  go: 'Go',
  rust: 'Rust',
  ruby: 'Ruby',
  php: 'PHP',
  kotlin: 'Kotlin',
  swift: 'Swift',
  lua: 'Lua',
  ini: 'INI',
  plaintext: 'Plain Text',
};

export function normalizeSnapshotLanguage(raw) {
  const key = String(raw || '').trim().toLowerCase();
  return LANGUAGE_ALIASES[key] || key || 'plaintext';
}

export function formatLanguageLabel(raw) {
  const key = normalizeSnapshotLanguage(raw);
  return LANGUAGE_LABELS[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Text');
}

/**
 * 使用应用内共享的 Shiki 高亮器把代码分词成逐行彩色 token，回退到纯文本。
 */
export async function tokenizeSnapshotCode(code, language, dark) {
  const palette = getCardPalette(dark);
  const normalized = String(code || '').replace(/\r\n?/g, '\n');
  const lang = normalizeSnapshotLanguage(language);
  const plain = () =>
    normalized.split('\n').map((line) => [
      { content: line, color: palette.text, fontStyle: 0 },
    ]);

  if (lang === 'plaintext' || lang === 'text') return plain();

  try {
    const { highlighter } = await prepareMonacoHighlighting();
    if (!highlighter.getLoadedLanguages().includes(lang)) return plain();
    const theme = dark ? DARK_THEME_NAME : LIGHT_THEME_NAME;
    const { tokens } = highlighter.codeToTokens(normalized, { lang, theme });
    return tokens.map((line) =>
      line.length
        ? line.map((token) => ({
            content: token.content,
            color: token.color || palette.text,
            fontStyle: token.fontStyle || 0,
          }))
        : [{ content: '', color: palette.text, fontStyle: 0 }],
    );
  } catch {
    return plain();
  }
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawBackdrop(ctx, width, height, backdropId, dark) {
  const preset = getBackdropPreset(backdropId);
  const stops = dark ? preset.dark : preset.light;
  if (!stops) return;
  const rad = ((preset.angle - 90) * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const half = (Math.abs(dx * width) + Math.abs(dy * height)) / 2;
  const cx = width / 2;
  const cy = height / 2;
  const gradient = ctx.createLinearGradient(
    cx - dx * half,
    cy - dy * half,
    cx + dx * half,
    cy + dy * half,
  );
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Subtle top-left studio sheen matching Vitality's soft light aesthetic.
  const sheen = ctx.createRadialGradient(
    width * 0.22,
    height * 0.14,
    0,
    width * 0.22,
    height * 0.14,
    Math.max(width, height) * 0.72,
  );
  sheen.addColorStop(0, dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.34)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, width, height);
}

async function loadDrawableImage(url) {
  if (!url) return null;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

function drawCardSurface(ctx, cardX, cardY, cardWidth, cardHeight, palette, bgImage, bgOpacity) {
  ctx.fillStyle = palette.surface;
  ctx.fillRect(cardX, cardY, cardWidth, cardHeight);

  if (!bgImage || !bgImage.naturalWidth || !bgImage.naturalHeight) return;
  const alpha = Math.max(0, Math.min(1, Number(bgOpacity ?? 0.2)));
  if (alpha <= 0) return;

  const iw = bgImage.naturalWidth;
  const ih = bgImage.naturalHeight;
  const scale = Math.max(cardWidth / iw, cardHeight / ih);
  const sourceWidth = cardWidth / scale;
  const sourceHeight = cardHeight / scale;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(
    bgImage,
    (iw - sourceWidth) / 2,
    (ih - sourceHeight) / 2,
    sourceWidth,
    sourceHeight,
    cardX,
    cardY,
    cardWidth,
    cardHeight,
  );
  ctx.restore();
}

function drawMokiMark(ctx, cx, cy, radius, accent) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${Math.round(radius * 1.18)}px 'Poppins', 'Segoe UI', system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('M', cx, cy + 0.5);
  ctx.restore();
}

function drawCardHeader(
  ctx,
  {
    cardX,
    cardY,
    cardWidth,
    headerHeight,
    windowStyle,
    palette,
    uiFont,
    title,
    badgeLabel,
    showFileName = true,
    showFileType = true,
  },
) {
  if (windowStyle === 'none') return;

  ctx.fillStyle = palette.headerBg;
  ctx.fillRect(cardX, cardY, cardWidth, headerHeight);

  ctx.strokeStyle = palette.headerBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cardX, cardY + headerHeight - 0.5);
  ctx.lineTo(cardX + cardWidth, cardY + headerHeight - 0.5);
  ctx.stroke();

  const midY = cardY + headerHeight / 2;
  let titleLeft = cardX + 18;

  if (windowStyle === 'mac') {
    const dots = ['#ff5f56', '#ffbd2e', '#27c93f'];
    dots.forEach((color, idx) => {
      ctx.beginPath();
      ctx.arc(cardX + 20 + idx * 18, midY, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });
    titleLeft = cardX + 76;
  } else if (windowStyle === 'moki') {
    drawMokiMark(ctx, cardX + 24, midY, 9, palette.accent);
    titleLeft = cardX + 42;
  }

  let rightLimit = cardX + cardWidth - 16;

  if (showFileType && badgeLabel) {
    ctx.font = `500 11px ${uiFont}`;
    const pillPadX = 8;
    const pillTextW = ctx.measureText(badgeLabel).width;
    const pillW = pillTextW + pillPadX * 2;
    const pillH = 20;
    const pillX = cardX + cardWidth - 16 - pillW;
    const pillY = midY - pillH / 2;
    roundedRectPath(ctx, pillX, pillY, pillW, pillH, 6);
    ctx.fillStyle = palette.accentBg;
    ctx.fill();
    ctx.fillStyle = palette.accent;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeLabel, pillX + pillW / 2, midY + 0.5);
    rightLimit = pillX - 10;
  }

  if (showFileName && title) {
    ctx.font = `500 12.5px ${uiFont}`;
    ctx.fillStyle = palette.muted;
    ctx.textBaseline = 'middle';
    const maxTitleW = Math.max(40, rightLimit - titleLeft - 4);
    let displayTitle = title;
    while (displayTitle.length > 1 && ctx.measureText(displayTitle).width > maxTitleW) {
      displayTitle = `${displayTitle.slice(0, -2)}…`;
    }
    if (windowStyle === 'mac') {
      const centeredX = cardX + cardWidth / 2;
      const halfW = ctx.measureText(displayTitle).width / 2;
      if (centeredX - halfW >= titleLeft && centeredX + halfW <= rightLimit) {
        ctx.textAlign = 'center';
        ctx.fillText(displayTitle, centeredX, midY + 0.5);
      } else {
        ctx.textAlign = 'left';
        ctx.fillText(displayTitle, titleLeft, midY + 0.5);
      }
    } else {
      ctx.textAlign = 'left';
      ctx.fillText(displayTitle, titleLeft, midY + 0.5);
    }
  }
}

/**
 * Render the card around the same read-only Monaco layout used for preview.
 */
export async function renderCodeSnapshotCanvas({
  tokens,
  dark,
  backdrop = 'vitality',
  padding = 40,
  radius = 14,
  shadow = true,
  windowStyle = 'moki',
  showFileName = true,
  showFileType = true,
  showLineNumbers = true,
  showIndentMarkers = false,
  showIndentRainbow = false,
  indentRainbowStyle = 'surface',
  tabSize = 2,
  showWatermark = true,
  appBackground = null,
  cardWidth = 680,
  scale = 2,
  title = '',
  language = 'plaintext',
  startLine = 1,
  fontSize = 13.5,
  fontFamily = "'JetBrains Mono', 'Source-HanSan', Consolas, monospace",
}) {
  const [runtime, bgImage] = await Promise.all([
    import('./snapshotMonaco'),
    loadDrawableImage(appBackground?.imageUrl),
    document.fonts?.ready,
  ]);
  await runtime.snapshotMonacoReady();
  const palette = getCardPalette(dark, Boolean(bgImage));
  const headerHeight = windowStyle === 'none' ? 0 : 42;
  const bodyPadX = 23;
  const bodyPadTop = windowStyle === 'none' ? 23 : 19;
  const bodyPadBottom = showWatermark ? 35 : 23;
  const indentWidths = showIndentRainbow
    ? computeIndentRainbowWidths(tokens.map((line) => line.map(({ content }) => content).join('')), tabSize)
    : [];
  const host = document.createElement('div');
  Object.assign(host.style, {
    position: 'fixed',
    top: '0',
    left: '-10000px',
    width: `${Math.max(1, cardWidth - bodyPadX * 2)}px`,
    height: '1800px',
    visibility: 'hidden',
    pointerEvents: 'none',
  });
  host.setAttribute('aria-hidden', 'true');
  document.body.appendChild(host);
  let instance;
  try {
    instance = runtime.createSnapshotMonaco(host, {
      tokens, dark, showLineNumbers, showIndentMarkers, startLine, tabSize, fontSize, fontFamily,
      foreground: palette.text, muted: palette.muted,
      indentWidths: [],
    });
    const { editor } = instance;
    return drawCodeSnapshotCard({
      dark, backdrop, padding, radius, shadow, windowStyle, showFileName, showFileType, showWatermark,
      appBackground, cardWidth, scale, title, language, palette, bgImage,
      headerHeight, bodyPadX, bodyPadTop, bodyPadBottom,
      codeHeight: editor.getContentHeight(),
      paintCode: (ctx, x, y, height) => runtime.paintSnapshotMonaco(ctx, host, editor, x, y, height, {
        indentWidths, indentRainbowStyle, tabSize,
        indentColors: dark ? SNAPSHOT_RAINBOW_COLORS_DARK : SNAPSHOT_RAINBOW_COLORS_LIGHT,
      }),
    });
  } finally {
    instance?.dispose();
    host.remove();
  }
}

function drawCodeSnapshotCard({
  dark, backdrop, padding, radius, shadow, windowStyle, showFileName, showFileType, showWatermark,
  appBackground, cardWidth, scale, title, language, palette, bgImage,
  headerHeight, bodyPadX, bodyPadTop, bodyPadBottom, codeHeight, paintCode,
}) {
  const uiFont = "'Poppins', 'Source-HanSan', 'Segoe UI', system-ui, sans-serif";
  const cardHeight = headerHeight + bodyPadTop + codeHeight + bodyPadBottom;
  const pad = getSnapshotFramePadding(backdrop, padding);
  const totalWidth = Math.ceil(cardWidth + pad * 2);
  const totalHeight = Math.ceil(cardHeight + pad * 2);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(totalWidth * scale);
  canvas.height = Math.round(totalHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  // 1. Backdrop
  if (pad) drawBackdrop(ctx, totalWidth, totalHeight, backdrop, dark);

  const cardX = pad;
  const cardY = pad;

  // 2. Soft elevation shadow
  if (shadow && pad) {
    ctx.save();
    ctx.shadowColor = dark ? 'rgba(0, 0, 0, 0.56)' : 'rgba(15, 23, 42, 0.20)';
    ctx.shadowBlur = 42;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 18;
    roundedRectPath(ctx, cardX, cardY, cardWidth, cardHeight, radius);
    ctx.fillStyle = palette.surface;
    ctx.fill();
    ctx.restore();
  }

  // 3. Card container (clipped to rounded rect)
  ctx.save();
  roundedRectPath(ctx, cardX, cardY, cardWidth, cardHeight, radius);
  ctx.clip();
  drawCardSurface(ctx, cardX, cardY, cardWidth, cardHeight, palette, bgImage, appBackground?.opacity);

  // 4. Window header
  drawCardHeader(ctx, {
    cardX,
    cardY,
    cardWidth,
    headerHeight,
    windowStyle,
    palette,
    uiFont,
    title,
    badgeLabel: formatLanguageLabel(language),
    showFileName,
    showFileType,
  });

  paintCode(ctx, cardX + bodyPadX, cardY + headerHeight + bodyPadTop, codeHeight);

  // 6. Subtle MokiDown watermark
  if (showWatermark) {
    const wmY = cardY + cardHeight - 18;
    const wmLabel = 'MokiDown';
    ctx.font = `600 11px ${uiFont}`;
    const textW = ctx.measureText(wmLabel).width;
    const rightX = cardX + cardWidth - 18;
    ctx.fillStyle = palette.watermarkText;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(wmLabel, rightX, wmY);
    drawMokiMark(ctx, rightX - textW - 11, wmY, 6.5, palette.accent);
  }

  ctx.restore();

  // 7. Crisp outer card hairline border
  ctx.save();
  roundedRectPath(ctx, cardX + 0.5, cardY + 0.5, cardWidth - 1, cardHeight - 1, radius);
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  return canvas;
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function inlineElementImages(clone) {
  const images = [...clone.querySelectorAll('img')];
  await Promise.all(
    images.map(async (img) => {
      const src = img.getAttribute('src') || '';
      if (!src || src.startsWith('data:')) return;
      try {
        const temp = new Image();
        temp.crossOrigin = 'anonymous';
        temp.src = src;
        await temp.decode();
        const c = document.createElement('canvas');
        c.width = temp.naturalWidth || img.naturalWidth || 1;
        c.height = temp.naturalHeight || img.naturalHeight || 1;
        c.getContext('2d').drawImage(temp, 0, 0);
        img.setAttribute('src', c.toDataURL('image/png'));
      } catch {
        const placeholder = clone.ownerDocument.createElement('span');
        placeholder.textContent = img.getAttribute('alt') || '[image]';
        placeholder.setAttribute(
          'style',
          'display:inline-block;padding:2px 8px;border-radius:4px;opacity:0.75;font-size:0.88em;',
        );
        img.replaceWith(placeholder);
      }
    }),
  );
}

/**
 * 将已渲染的 Markdown 预览 DOM 节点导出为高分辨率卡片 PNG。
 * 通过自包含 SVG foreignObject 绘入 Canvas，完整保留标题、表格、任务列表、代码块与公式。
 */
export async function renderMarkdownSnapshotCanvas(contentElement, options) {
  const {
    dark,
    backdrop = 'vitality',
    padding = 40,
    radius = 14,
    shadow = true,
    windowStyle = 'moki',
    showFileName = true,
    showFileType = true,
    showWatermark = true,
    appBackground = null,
    cardWidth = 680,
    scale = 2,
    title = '',
    fontSize = 14,
    fallbackTokens,
  } = options;

  await document.fonts?.ready?.catch?.(() => {});
  const bgImage = appBackground?.imageUrl ? await loadDrawableImage(appBackground.imageUrl) : null;
  const hasAppBackground = Boolean(bgImage);
  const palette = getCardPalette(dark, hasAppBackground);
  const headerHeight = windowStyle === 'none' ? 0 : 42;
  const bodyPadX = SNAPSHOT_MARKDOWN_INSET;
  const bodyPadTop = 23;
  const bodyPadBottom = showWatermark ? 44 : 26;
  const innerWidth = Math.max(1, cardWidth - bodyPadX * 2);

  if (!contentElement) {
    return renderCodeSnapshotCanvas({
      ...options,
      tokens: fallbackTokens || [[{ content: '', color: palette.text, fontStyle: 0 }]],
      language: 'markdown',
      showLineNumbers: false,
      showIndentRainbow: false,
    });
  }

  const clone = contentElement.cloneNode(true);
  clone.dataset.snapshotTheme = dark ? 'dark' : 'light';
  clone.querySelectorAll('button.lang-tag, .md-preview__fold').forEach((el) => el.remove());
  const appStyle = getComputedStyle(document.documentElement);
  const styles = {
    ...snapshotMarkdownVariables(palette),
    '--font-app': appStyle.getPropertyValue('--font-app'),
    '--font-editor': appStyle.getPropertyValue('--font-editor'),
    '--snap-font-size': `${fontSize}px`,
  };
  for (const [name, value] of Object.entries(styles)) clone.style.setProperty(name, value);

  const [{ snapshotMarkdownStyles }] = await Promise.all([
    import('./snapshotMarkdownStyles'),
    inlineElementImages(clone),
  ]);
  const stylesheet = await snapshotMarkdownStyles(clone);
  const measureHost = document.createElement('div');
  measureHost.style.cssText = `position:fixed;left:-10000px;top:0;width:${innerWidth}px;visibility:hidden;pointer-events:none`;
  measureHost.setAttribute('aria-hidden', 'true');
  measureHost.append(clone);
  document.body.append(measureHost);

  let measuredHeight;
  try {
    await Promise.all([...clone.querySelectorAll('img')].map((image) => image.decode().catch(() => {})));
    measuredHeight = Math.max(1, Math.ceil(clone.getBoundingClientRect().height), clone.scrollHeight);
  } finally {
    measureHost.remove();
  }
  const cardHeight = headerHeight + bodyPadTop + measuredHeight + bodyPadBottom;
  const pad = getSnapshotFramePadding(backdrop, padding);
  const totalWidth = Math.ceil(cardWidth + pad * 2);
  const totalHeight = Math.ceil(cardHeight + pad * 2);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(totalWidth * scale);
  canvas.height = Math.round(totalHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  // Draw backdrop, shadow, card chrome, header & watermark natively in Canvas2D for crisp vectors.
  if (pad) drawBackdrop(ctx, totalWidth, totalHeight, backdrop, dark);

  const cardX = pad;
  const cardY = pad;
  const uiFont = "'Poppins', 'Source-HanSan', 'Segoe UI', system-ui, sans-serif";

  if (shadow && pad) {
    ctx.save();
    ctx.shadowColor = dark ? 'rgba(0, 0, 0, 0.56)' : 'rgba(15, 23, 42, 0.20)';
    ctx.shadowBlur = 42;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 18;
    roundedRectPath(ctx, cardX, cardY, cardWidth, cardHeight, radius);
    ctx.fillStyle = palette.surface;
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  roundedRectPath(ctx, cardX, cardY, cardWidth, cardHeight, radius);
  ctx.clip();
  drawCardSurface(ctx, cardX, cardY, cardWidth, cardHeight, palette, bgImage, appBackground?.opacity);

  drawCardHeader(ctx, {
    cardX,
    cardY,
    cardWidth,
    headerHeight,
    windowStyle,
    palette,
    uiFont,
    title,
    badgeLabel: 'Markdown',
    showFileName,
    showFileType,
  });

  // Serialize cloned Markdown DOM inside an XHTML foreignObject SVG.
  const serializer = new XMLSerializer();
  const xhtml = serializer.serializeToString(clone);
  const svgMarkup = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${innerWidth}" height="${measuredHeight}" viewBox="0 0 ${innerWidth} ${measuredHeight}">`,
    `<foreignObject x="0" y="0" width="${innerWidth}" height="${measuredHeight}">`,
    `<div xmlns="http://www.w3.org/1999/xhtml" class="snap-root">`,
    `<style>${escapeXml(stylesheet)}</style>`,
    xhtml,
    `</div></foreignObject></svg>`,
  ].join('');

  try {
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
    await img.decode();
    ctx.drawImage(img, cardX + bodyPadX, cardY + headerHeight + bodyPadTop, innerWidth, measuredHeight);
  } catch {
    ctx.restore();
    return renderCodeSnapshotCanvas({
      ...options,
      tokens: fallbackTokens || [[{ content: contentElement.textContent || '', color: palette.text, fontStyle: 0 }]],
      language: 'markdown',
      showLineNumbers: false,
      showIndentRainbow: false,
    });
  }

  if (showWatermark) {
    const wmY = cardY + cardHeight - 18;
    const wmLabel = 'MokiDown';
    ctx.font = `600 11px ${uiFont}`;
    const textW = ctx.measureText(wmLabel).width;
    const rightX = cardX + cardWidth - 18;
    ctx.fillStyle = palette.watermarkText;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(wmLabel, rightX, wmY);
    drawMokiMark(ctx, rightX - textW - 11, wmY, 6.5, palette.accent);
  }

  ctx.restore();

  ctx.save();
  roundedRectPath(ctx, cardX + 0.5, cardY + 0.5, cardWidth - 1, cardHeight - 1, radius);
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  return canvas;
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to encode PNG'));
    }, 'image/png');
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function canvasToWindowsDib(canvas) {
  const { width, height } = canvas;
  if (!width || !height || width * height * 4 > 32 * 1024 * 1024) return null;
  const header = new DataView(new ArrayBuffer(124));
  header.setUint32(0, header.byteLength, true);
  header.setInt32(4, width, true);
  header.setInt32(8, -height, true);
  header.setUint16(12, 1, true);
  header.setUint16(14, 32, true);
  header.setUint32(16, 3, true); // BI_BITFIELDS
  header.setUint32(20, width * height * 4, true);
  header.setUint32(40, 0x00ff0000, true);
  header.setUint32(44, 0x0000ff00, true);
  header.setUint32(48, 0x000000ff, true);
  header.setUint32(52, 0xff000000, true);
  header.setUint32(56, 0x73524742, true); // LCS_sRGB
  header.setUint32(108, 4, true); // LCS_GM_IMAGES
  const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);
  for (let i = 0; i < data.length; i += 4) {
    const red = data[i];
    data[i] = data[i + 2];
    data[i + 2] = red;
  }
  return new Blob([header.buffer, data]);
}

/**
 * 将截图 Canvas 复制到系统剪贴板（优先 Web Clipboard，Windows Tauri 回退原生 PNG+DIB）。
 */
export async function copySnapshotCanvas(canvas) {
  const png = await canvasToPngBlob(canvas);
  try {
    if (!navigator.clipboard?.write || typeof window.ClipboardItem !== 'function') {
      throw new Error('Clipboard image API unavailable');
    }
    await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': png })]);
  } catch (error) {
    if (!window.__TAURI_INTERNALS__ || !/Windows/i.test(navigator.userAgent)) throw error;
    const dib = canvasToWindowsDib(canvas);
    const [contentBase64, dibBase64] = await Promise.all([
      blobToBase64(png),
      dib ? blobToBase64(dib) : null,
    ]);
    await invoke('write_clipboard_image', { contentBase64, dibBase64 });
  }
  return png;
}

/**
 * 将截图 Canvas 保存为本地 PNG 文件（桌面端弹出原生保存对话框，浏览器端触发下载）。
 */
export async function saveSnapshotCanvas(canvas, suggestedName) {
  const png = await canvasToPngBlob(canvas);
  if (window.__TAURI_INTERNALS__) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
      defaultPath: suggestedName,
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    });
    if (!path) return { saved: false, path: null };
    const contentBase64 = await blobToBase64(png);
    await invoke('write_binary_file', { path, contentBase64 });
    return { saved: true, path };
  }

  const url = URL.createObjectURL(png);
  const link = document.createElement('a');
  link.href = url;
  link.download = suggestedName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { saved: true, path: suggestedName };
}
