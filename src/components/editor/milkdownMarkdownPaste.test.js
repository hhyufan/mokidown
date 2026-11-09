import { describe, expect, it } from 'vitest';
import { tsvToMarkdownTable } from './milkdownMarkdownPaste';

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
    const text = 'a\tb\n\n1\tx | y\n';
    expect(tsvToMarkdownTable(text)).toBe('| a | b |\n| --- | --- |\n| 1 | x \\| y |');
  });

  it('returns null for single-column or short input', () => {
    expect(tsvToMarkdownTable('only one column')).toBeNull();
    expect(tsvToMarkdownTable('a\tb')).toBeNull();
    expect(tsvToMarkdownTable('a\nb\nc')).toBeNull();
  });
});
