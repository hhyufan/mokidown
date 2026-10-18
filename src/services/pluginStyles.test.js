import { afterEach, expect, it } from 'vitest';
import { scopeMarkdownCss, setPluginStyle, clearPluginStyles } from './pluginStyles';
afterEach(() => { clearPluginStyles('test.theme'); clearPluginStyles('other.theme'); });
it('scopes comma selectors, pseudo functions, root declarations and media rules', () => {
  const css = scopeMarkdownCss(':root {color: red} h1, :is(h2,h3) {color: blue} @media screen { p {color: green} }');
  expect(css).toContain('.md-preview {');
  expect(css).toContain('.md-preview h1,.md-preview :is(h2,h3)');
  expect(css).toContain('@media screen');
});
it('rejects remote resources and removes only the disposed plugin styles', () => {
  expect(() => scopeMarkdownCss('@import "https://evil.test";')).toThrow();
  expect(() => scopeMarkdownCss('p {background: url(https://evil.test)}')).toThrow();
  expect(() => scopeMarkdownCss('p {position: fixed}')).toThrow();
  setPluginStyle('test.theme','reading','markdown','h1{color:red}');
  setPluginStyle('other.theme','reading','markdown','h1{color:blue}');
  clearPluginStyles('test.theme');
  expect(document.querySelectorAll('[data-plugin-style]')).toHaveLength(1);
  expect(document.querySelector('[data-plugin-style]').dataset.pluginStyle).toBe('other.theme:reading');
});
