export const LIGHT_THEME_NAME = 'one-light';
export const DARK_THEME_NAME = 'one-dark-pro';

// Include embedded grammars so fenced Markdown is highlighted on the first visit.
const LANGUAGES = [
  'markdown',
  'javascript',
  'typescript',
  'json',
  'html',
  'css',
  'scss',
  'python',
  'java',
  'c',
  'cpp',
  'csharp',
  'go',
  'rust',
  'ruby',
  'php',
  'shell',
  'yaml',
  'xml',
  'sql',
  'lua',
  'kotlin',
  'swift',
  'powershell',
  'ini',
];

let request;

export function prepareMonacoHighlighting() {
  request ??= Promise.all([import('shiki'), import('@shikijs/monaco')])
    .then(async ([{ createHighlighter }, adapter]) => {
      const highlighter = await createHighlighter({
        themes: [DARK_THEME_NAME, LIGHT_THEME_NAME],
        langs: LANGUAGES,
      });
      return { highlighter, adapter };
    })
    .catch((error) => {
      request = undefined;
      throw error;
    });
  return request;
}
