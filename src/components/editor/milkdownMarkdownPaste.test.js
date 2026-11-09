import { describe, expect, it } from 'vitest';
import { looksLikeMarkdown, mixedTextToMarkdown, tsvToMarkdownTable } from './milkdownMarkdownPaste';

describe('tsvToMarkdownTable', () => {
  it('converts a spreadsheet paste into a GFM table', () => {
    const text = [
      '角色\t类型\t作用',
      '开关\tCancellationTokenSource\t由发起方持有，调用 Cancel() 表示“不要做了”',
      '凭证\tCancellationToken\t只读结构体，发给每个干活的方法，供其查询',
      '干活方\t你的方法\t在检查点主动看凭证，决定退出还是抛异常',
    ].join('\n');
    expect(tsvToMarkdownTable(text)).toBe([
      '| 角色 | 类型 | 作用 |',
      '| --- | --- | --- |',
      '| 开关 | CancellationTokenSource | 由发起方持有，调用 Cancel() 表示“不要做了” |',
      '| 凭证 | CancellationToken | 只读结构体，发给每个干活的方法，供其查询 |',
      '| 干活方 | 你的方法 | 在检查点主动看凭证，决定退出还是抛异常 |',
    ].join('\n'));
  });

  it('leaves the top-left header empty when the first row misses a cell', () => {
    const text = [
      'int?（可空值类型）\tstring?（可空引用类型）',
      '本质\tNullable<int> 结构体\t就是 string，只是编译器注解',
      '运行时\t真实存在的类型\t没有区别',
    ].join('\n');
    expect(tsvToMarkdownTable(text)).toBe([
      '|  | int?（可空值类型） | string?（可空引用类型） |',
      '| --- | --- | --- |',
      '| 本质 | Nullable<int> 结构体 | 就是 string，只是编译器注解 |',
      '| 运行时 | 真实存在的类型 | 没有区别 |',
    ].join('\n'));
  });

  it('pads a short data row with empty cells', () => {
    expect(tsvToMarkdownTable('a\tb\tc\n1\t2')).toBe('| a | b | c |\n| --- | --- | --- |\n| 1 | 2 |  |');
  });

  it('ignores blank lines and escapes pipes in cells', () => {
    expect(tsvToMarkdownTable('a\tb\n\n1\tx | y\n')).toBe('| a | b |\n| --- | --- |\n| 1 | x \\| y |');
  });

  it('returns null for single-column or short input', () => {
    expect(tsvToMarkdownTable('only one column')).toBeNull();
    expect(tsvToMarkdownTable('a\tb')).toBeNull();
    expect(tsvToMarkdownTable('a\nb\nc')).toBeNull();
  });
});

describe('mixedTextToMarkdown', () => {
  it('keeps headings and converts each tab-separated block separately', () => {
    const text = [
      '五、常见警告',
      '编号\t含义',
      'CS8600\t把可能为 null 的值赋给非空类型',
      'CS8601\t可能的 null 引用赋值',
      '六、CS8618 的四种解法',
      '方式\t写法\t适用',
      'required\tpublic required string Name { get; init; }\t调用方必须赋值，否则编译错误',
      '给初值\tpublic string Name { get; set; } = "";\t有合理默认值',
    ].join('\n');
    const markdown = mixedTextToMarkdown(text);
    expect(markdown).toContain('五、常见警告');
    expect(markdown).toContain('| 编号 | 含义 |');
    expect(markdown).toContain('| CS8600 | 把可能为 null 的值赋给非空类型 |');
    expect(markdown).toContain('六、CS8618 的四种解法');
    expect(markdown).toContain('| 方式 | 写法 | 适用 |');
    expect(markdown).toContain('| required | public required string Name { get; init; } | 调用方必须赋值，否则编译错误 |');
  });

  it('returns null when there is no convertible table block', () => {
    expect(mixedTextToMarkdown('普通段落\n没有制表符')).toBeNull();
    expect(mixedTextToMarkdown('单行\t两列')).toBeNull();
  });
});

describe('looksLikeMarkdown', () => {
  it('detects markdown source and ignores rendered plain text', () => {
    expect(looksLikeMarkdown('## 标题\n\n内容')).toBe(true);
    expect(looksLikeMarkdown('| a | b |\n| --- | --- |')).toBe(true);
    expect(looksLikeMarkdown('**粗体**')).toBe(true);
    expect(looksLikeMarkdown('五、常见警告\n编号 含义\nCS8600 把可能为 null 的值赋给非空类型')).toBe(false);
  });
});
