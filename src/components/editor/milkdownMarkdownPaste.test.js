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

  it('ignores blank lines and escapes pipes in cells', () => {
    const text = 'a\tb\n\n1\tx | y\n';
    expect(tsvToMarkdownTable(text)).toBe('| a | b |\n| --- | --- |\n| 1 | x \\| y |');
  });

  it('returns null for single-column, short or ragged input', () => {
    expect(tsvToMarkdownTable('only one column')).toBeNull();
    expect(tsvToMarkdownTable('a\tb\n1\t2\t3')).toBeNull();
    expect(tsvToMarkdownTable('a\tb')).toBeNull();
  });
});
