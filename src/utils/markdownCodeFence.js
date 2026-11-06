export const CODE_FENCE_LANGUAGE_EVENT = 'moki:code-fence-language';

export const markdownFenceLanguages = [
  ['javascript', 'JavaScript', 'js', 'jsx'], ['typescript', 'TypeScript', 'ts', 'tsx'], ['python', 'Python', 'py'],
  ['json', 'JSON'], ['html', 'HTML'], ['xml', 'XML'], ['css', 'CSS'], ['scss', 'SCSS', 'sass'],
  ['csharp', 'C#', 'cs', 'c#'], ['c', 'C'], ['cpp', 'C++', 'c++'], ['java', 'Java'], ['kotlin', 'Kotlin', 'kt'],
  ['go', 'Go'], ['rust', 'Rust', 'rs'], ['ruby', 'Ruby', 'rb'], ['dart', 'Dart'], ['shell', 'Shell', 'sh', 'bash', 'powershell'],
  ['sql', 'SQL'], ['yaml', 'YAML', 'yml'], ['toml', 'TOML'], ['mermaid', 'Mermaid'],
];

export function readMarkdownFence(line) {
  const match = /^( {0,3})(`{3,})[ \t]*([\w+.#-]*)[ \t]*$/.exec(line);
  return match ? { indent: match[1], fence: match[2], language: match[3] } : null;
}

export function completedFenceLanguage(value) {
  const language = value.toLowerCase();
  // Wait for explicit confirmation if the name could still become another one.
  if (markdownFenceLanguages.some(([id]) => id === language)
    && !markdownFenceLanguages.some(([id, , ...aliases]) => [id, ...aliases].some(
      (name) => name !== language && name.startsWith(language),
    ))) return language;
  return null;
}
