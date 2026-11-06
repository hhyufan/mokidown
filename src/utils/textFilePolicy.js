// Shared by browser/SAF readers and file-head classification. Desktop enforces
// the same rules in text_file.rs before returning any content over IPC.
export const MAX_TEXT_BYTES = 20 * 1024 * 1024;
export const HEAD_BYTES = 8 * 1024;

export class TextFileError extends Error {
  constructor(kind, message = kind) {
    super(message);
    this.name = 'TextFileError';
    this.kind = kind;
  }
}

export function decodeTextBytes(bytes, { partial = false } = {}) {
  if (bytes == null) throw new TextFileError('unreadable');
  const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (data.byteLength > MAX_TEXT_BYTES) throw new TextFileError('too-large');
  if ((data[0] === 0xff && data[1] === 0xfe && data[2] === 0 && data[3] === 0)
    || (data[0] === 0 && data[1] === 0 && data[2] === 0xfe && data[3] === 0xff)) {
    throw new TextFileError('invalid-encoding');
  }
  const encoding = data[0] === 0xff && data[1] === 0xfe ? 'UTF-16LE'
    : data[0] === 0xfe && data[1] === 0xff ? 'UTF-16BE' : 'UTF-8';
  if (encoding === 'UTF-8' && data.includes(0)) throw new TextFileError('binary');
  let content;
  try {
    // A sampled head may end inside a character; a complete read must not.
    content = new TextDecoder(encoding, { fatal: true }).decode(data, { stream: partial });
  } catch {
    throw new TextFileError('invalid-encoding');
  }
  let controls = 0, length = 0;
  for (const character of content) {
    const code = character.codePointAt(0);
    if (code === 0) throw new TextFileError('binary');
    if (code < 9 || (code > 13 && code < 32) || code === 127) controls++;
    length++;
  }
  if (length && controls / length > .3) throw new TextFileError('binary');
  return { content, encoding };
}

export function encodeTextBytes(content, encoding = 'UTF-8') {
  if (!/^UTF-16(?:LE|BE)$/i.test(encoding)) return new TextEncoder().encode(content);
  const littleEndian = encoding.toUpperCase() === 'UTF-16LE';
  const bytes = new Uint8Array(2 + content.length * 2), view = new DataView(bytes.buffer);
  view.setUint16(0, 0xfeff, littleEndian);
  for (let index = 0; index < content.length; index++) view.setUint16(2 + index * 2, content.charCodeAt(index), littleEndian);
  return bytes;
}
