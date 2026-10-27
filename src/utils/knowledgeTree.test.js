import { describe, expect, it } from 'vitest';
import { companionTreePaths, findCodeBlock, markdownFences, treeReference } from './knowledgeTree';
import { parseTreeText } from './mgtree';

describe('knowledge tree navigation', () => {
  it('parses all jump forms, C++ and C# without consuming increment operators as language names', () => {
    expect(parseTreeText('A >js[2]\nB >js++\nC >js+=3\nD >js\nE >c++[2]\nF >c#++')
      .map(({ jumpLanguage, jumpIndex }) => [jumpLanguage, jumpIndex]))
      .toEqual([['js', 2], ['js', 3], ['js', 6], ['js', 6], ['c++', 2], ['c#', 1]]);
  });
  it('keeps nested fences inside examples and handles tilde fences and unclosed blocks', () => {
    const blocks = markdownFences('````md\n```tree\nNot a tree\n```\n````\n~~~tree\nRoot\n  A >js++\n~~~\n```mgtree\nLast');
    expect(blocks.map((b) => [b.language, b.line, b.source])).toEqual([
      ['md', 1, '```tree\nNot a tree\n```'], ['tree', 6, 'Root\n  A >js++'], ['mgtree', 10, 'Last'],
    ]);
  });
  it('resolves same-name and heading companions relative to the Markdown directory', () => {
    expect(companionTreePaths('C:\\notes\\Lesson.md', '# 知识结构')).toEqual([
      'C:\\notes\\Lesson.mgtree', 'C:\\notes\\trees\\Lesson.mgtree',
      'C:\\notes\\知识结构.mgtree', 'C:\\notes\\trees\\知识结构.mgtree',
    ]);
    expect(companionTreePaths('', '# Title')).toEqual([]);
    expect(treeReference('@tree("trees/a")')).toBe('trees/a.mgtree');
    expect(treeReference('Root\n  Child')).toBeNull();
  });
  it('finds language-relative indexes scoped to the preview and rejects invalid indexes', () => {
    const root = document.createElement('div');
    root.innerHTML = '<pre data-code-language="javascript"></pre><pre data-code-language="python"></pre><pre data-code-language="javascript"></pre><pre data-code-language="csharp"></pre>';
    expect(findCodeBlock(root, 'JS', 2)).toBe(root.children[2]);
    expect(findCodeBlock(root, 'c#', 1)).toBe(root.children[3]);
    for (const index of [0, -1, 1.5, 3]) expect(findCodeBlock(root, 'js', index)).toBeNull();
  });
});
