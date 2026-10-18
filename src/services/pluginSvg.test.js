import { expect, it } from 'vitest';
import { sanitizePluginSvg } from './pluginSvg';
it('accepts local vectors but rejects executable or remote SVG content', () => {
  expect(sanitizePluginSvg('<svg viewBox="0 0 24 24"><path d="M0 0" stroke="currentColor"/></svg>')).toContain('currentColor');
  for (const svg of ['<svg onpointerenter="alert(1)"/>','<svg><foreignObject/></svg>','<svg><image href="https://evil.test"/></svg>','<svg><path fill="url(https://evil.test)"/></svg>']) expect(() => sanitizePluginSvg(svg)).toThrow();
});
