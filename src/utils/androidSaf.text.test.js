import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileText, writeFileText } from './androidSaf';
import { encodeTextBytes, MAX_TEXT_BYTES } from './textFilePolicy';

const bridge = { statUri: vi.fn(), readFile: vi.fn(), writeFile: vi.fn() };
const asBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
beforeEach(() => {
  window.AndroidSaf = bridge;
  vi.clearAllMocks();
  bridge.statUri.mockReturnValue(JSON.stringify({ is_file: true, size: 8 }));
  bridge.writeFile.mockReturnValue(JSON.stringify({ ok: true, size: 8 }));
});
afterEach(() => { delete window.AndroidSaf; });

it('checks size before crossing the bridge and propagates a bounded native read failure', async () => {
  bridge.statUri.mockReturnValueOnce(JSON.stringify({ is_file: true, size: MAX_TEXT_BYTES + 1 }));
  await expect(readFileText('content://large')).rejects.toMatchObject({ kind: 'too-large' });
  expect(bridge.readFile).not.toHaveBeenCalled();
  bridge.readFile.mockReturnValueOnce(JSON.stringify({ ok: false, kind: 'too-large' }));
  await expect(readFileText('content://grew')).rejects.toMatchObject({ kind: 'too-large' });
});

it('rejects binary content rather than decoding it into replacement text', async () => {
  bridge.readFile.mockReturnValueOnce(JSON.stringify({ ok: true, content_base64: asBase64([0xef, 0xbb, 0xbf, 0]) }));
  await expect(readFileText('content://binary')).rejects.toMatchObject({ kind: 'binary' });
});

it.each(['UTF-16LE', 'UTF-16BE'])('round-trips %s through the original byte bridge', async (encoding) => {
  const bytes = encodeTextBytes('中文 😀', encoding);
  bridge.readFile.mockReturnValueOnce(JSON.stringify({ ok: true, content_base64: asBase64(bytes), size: bytes.length }));
  const read = await readFileText('content://text');
  expect(read).toMatchObject({ content: '中文 😀', encoding });
  await writeFileText('content://text', read.content, read.encoding);
  expect(bridge.writeFile).toHaveBeenCalledWith('content://text', asBase64(bytes));
});
