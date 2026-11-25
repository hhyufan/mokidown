import { expect, it } from 'vitest';
import { formatJsonDocument } from './jsonDocument';

it('minifies JSON without losing large numbers, duplicate keys or string escapes', () => {
  expect(formatJsonDocument(String.raw`{ "a": 9007199254740993, "a": "\u00a0 a : b" }`))
    .toBe(String.raw`{"a":9007199254740993,"a":"\u00a0 a : b"}`);
});

it('expands nested JSON and preserves empty collections and scalar forms', () => {
  expect(formatJsonDocument('{"items":[{},[],{"loss":-0,"value":1e3}]}', '  '))
    .toBe("{\n  \"items\": [\n    {},\n    [],\n    {\n      \"loss\": -0,\n      \"value\": 1e3\n    }\n  ]\n}");
  expect(formatJsonDocument('  true  ', '  ')).toBe('true');
});

it('rejects invalid JSON before generating a replacement', () => {
  expect(() => formatJsonDocument('{"a":,}')).toThrow(SyntaxError);
});
