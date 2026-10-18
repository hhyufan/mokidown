const activeStyles = new Map();
const ROOT = '.md-preview';

// Split only top-level selector commas, preserving :is(), :not() and strings.
function splitSelectors(text) {
  const selectors = []; let start = 0, depth = 0, quote = '', escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '(' || char === '[') depth++;
    if (char === ')' || char === ']') depth--;
    if (char === ',' && depth === 0) { selectors.push(text.slice(start, index).trim()); start = index + 1; }
  }
  selectors.push(text.slice(start).trim()); return selectors;
}

export function scopeMarkdownCss(css) {
  if (typeof css !== 'string' || css.length > 128 * 1024) throw new Error('Markdown stylesheet exceeds 128 KiB');
  if (/\\|@import|@font-face|url\s*\(|image-set\s*\(|expression\s*\(/i.test(css)) throw new Error('Stylesheets must use local declarations without external resources or escaped tokens');
  const parser = document.createElement('style'); parser.media = 'not all'; parser.textContent = css;
  document.head.append(parser);
  const compile = (rules) => Array.from(rules).map((rule) => {
    if (rule.type === 1) {
      if (rule.cssRules?.length) throw new Error('Flatten nested CSS before packaging');
      const selectors = splitSelectors(rule.selectorText).map((selector) => {
        if (/^[+~>]/.test(selector)) throw new Error('Relative CSS selectors are unsupported');
        if (selector === ':root' || selector === ':scope') return ROOT;
        return `${ROOT} ${selector}`;
      });
      // Keep declarations inside the document box; plugins cannot cover the UI.
      for (const property of ['position', 'z-index']) {
        const value = rule.style.getPropertyValue(property).trim();
        if (property === 'position' && /^(fixed|sticky)$/i.test(value)) throw new Error('Fixed and sticky positioning are outside Markdown styling scope');
      }
      return `${selectors.join(',')} { ${rule.style.cssText} }`;
    }
    if (rule.type === 4) return `@media ${rule.conditionText || rule.media.mediaText} { ${compile(rule.cssRules)} }`;
    if (rule.type === 12) return `@supports ${rule.conditionText} { ${compile(rule.cssRules)} }`;
    throw new Error('Only CSS rules, @media and @supports are supported');
  }).join('\n');
  try { return compile(parser.sheet.cssRules); } finally { parser.remove(); }
}

export function setPluginStyle(pluginId, id, target, css) {
  if (target !== 'markdown' || !/^[a-z0-9][a-z0-9.-]{0,79}$/.test(id || '')) throw new Error('Invalid plugin style target or ID');
  const compiled = scopeMarkdownCss(css);
  const key = `${pluginId}:${id}`;
  const style = activeStyles.get(key) || document.createElement('style');
  style.dataset.pluginStyle = key; style.textContent = compiled;
  if (!style.isConnected) document.head.append(style);
  activeStyles.set(key, style);
}
export function removePluginStyle(pluginId, id) {
  const key = `${pluginId}:${id}`; activeStyles.get(key)?.remove(); activeStyles.delete(key);
}
export function clearPluginStyles(pluginId) {
  for (const key of activeStyles.keys()) if (key.startsWith(`${pluginId}:`)) { activeStyles.get(key).remove(); activeStyles.delete(key); }
}
