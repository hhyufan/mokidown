import { expect, it } from 'vitest';
import { decodeTextBytes, encodeTextBytes, MAX_TEXT_BYTES } from './textFilePolicy';

it('strictly round-trips UTF-8 and BOM UTF-16 including emoji and CRLF', () => {
  for (const encoding of ['UTF-8', 'UTF-16LE', 'UTF-16BE']) {
    const content = '中文 😀\r\nnext';
    expect(decodeTextBytes(encodeTextBytes(content, encoding))).toEqual({ content, encoding });
  }
});

it('a BOM never exempts the body from binary/encoding checks', () => {
  expect(() => decodeTextBytes([0xef, 0xbb, 0xbf, 0x61, 0])).toThrow();
  expect(() => decodeTextBytes(encodeTextBytes('a\0b', 'UTF-16LE'))).toThrow();
  expect(() => decodeTextBytes([0xff, 0xfe, 0, 0])).toThrow();
  expect(() => decodeTextBytes([0xff, 0xff])).toThrow();
  expect(() => decodeTextBytes([1, 2, 3, 4])).toThrow();
});

it('permits split characters only at a sampled head boundary', () => {
  const bytes = new TextEncoder().encode('text 😀');
  expect(decodeTextBytes(bytes.slice(0, -1), { partial: true }).content).toBe('text ');
  expect(() => decodeTextBytes(bytes.slice(0, -1))).toThrow();
  const utf16 = encodeTextBytes('text 😀', 'UTF-16BE');
  expect(decodeTextBytes(utf16.slice(0, -1), { partial: true }).content).toBe('text ');
  expect(() => decodeTextBytes(utf16.slice(0, -1))).toThrow();
});

it('distinguishes empty text, an unavailable head, and oversized input', () => {
  expect(decodeTextBytes([]).content).toBe('');
  expect(() => decodeTextBytes(null)).toThrow();
  expect(() => decodeTextBytes(new Uint8Array(MAX_TEXT_BYTES + 1))).toThrow();
});
