import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dictionaryId = 'virtual:moki-monaco-zh';
const runtime = fileURLToPath(new URL('../src/utils/monacoNls.js', import.meta.url));

export function monacoLocalization() {
  let dictionary;
  return {
    name: 'moki-monaco-localization',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === dictionaryId) return `\0${source}`;
      if (importer?.replaceAll('\\', '/').includes('/monaco-editor/esm/vs/') &&
        /(?:^|\/)nls\.js$/.test(source)) return runtime;
      return null;
    },
    load(id) {
      if (id !== `\0${dictionaryId}`) return null;
      if (!dictionary) {
        // The ESM distribution uses English defaults. The same package's
        // debug distribution pairs those defaults with the official NLS indices.
        const root = dirname(require.resolve('monaco-editor/package.json'));
        const locale = readFileSync(join(root, 'dev/vs/nls.messages.zh-cn.js'), 'utf8');
        const messages = JSON.parse(locale.match(/globalThis\._VSCODE_NLS_MESSAGES\s*=\s*(\[[^\r\n]*\]);/)?.[1] ?? 'null');
        if (!Array.isArray(messages)) this.error('Unable to read the Monaco Chinese message table.');
        const editor = readFileSync(join(root, 'dev/vs/editor/editor.main.js'), 'utf8');
        const calls = /\blocalize2?\)?\(\s*(\d+)\s*,\s*("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')/g;
        const lookup = new Map();
        for (const [, index, literal] of editor.matchAll(calls)) {
          const translation = messages[Number(index)];
          if (typeof translation !== 'string') continue;
          const original = this.parse(`(${literal})`).body[0].expression.value;
          if (!lookup.has(original)) lookup.set(original, translation);
        }
        if (!lookup.has('Find') || !lookup.has('Replace All')) {
          this.error('The Monaco localization table is missing the Find toolbar labels.');
        }
        dictionary = `export default ${JSON.stringify(Object.fromEntries(lookup))};`;
      }
      return dictionary;
    },
  };
}
