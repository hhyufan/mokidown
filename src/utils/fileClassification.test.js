import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyFile, clearClassificationCache, sniffTextHead } from './fileClassification';
import { checkFileTextHead, getFileInfo, readFileHead } from '@utils/tauriApi';

const state = vi.hoisted(() => ({ bytes: null, info: { is_file: true, size: 10, modified: 1 } }));

vi.mock('@utils/tauriApi', () => ({
  getFileInfo: vi.fn(async () => state.info),
  checkFileTextHead: vi.fn(async () => {}),
  readFileHead: vi.fn(async () => state.bytes),
}));

beforeEach(() => {
  vi.clearAllMocks(); clearClassificationCache();
  state.info = { is_file: true, size: 10, modified: 1 };
  state.bytes = new TextEncoder().encode('plain text');
});

describe('file classification', () => {
  it('treats BOM text and plain UTF-8 as text', () => {
    expect(sniffTextHead(Uint8Array.from([0xef, 0xbb, 0xbf, 0x61]))).toBe('text');
    expect(sniffTextHead(Uint8Array.from([0x23, 0x20, 0x68, 0x69]))).toBe('text');
    expect(sniffTextHead(Uint8Array.from([0xff, 0xfe, 0x61, 0x00]))).toBe('text');
  });

  it('treats NUL bytes and control-heavy heads as binary', () => {
    expect(sniffTextHead(Uint8Array.from([0x50, 0x4b, 0x03, 0x00]))).toBe('binary');
    expect(sniffTextHead(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).toBe('binary');
  });

  it('classifies by content, not by extension', async () => {
    state.bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00]);
    expect((await classifyFile('/tmp/image.png')).kind).toBe('binary');

    state.bytes = Uint8Array.from([0x64, 0x6f, 0x63, 0x6b, 0x65, 0x72]);
    expect((await classifyFile('/tmp/Dockerfile')).kind).toBe('text');
  });

  it('delegates native classification to the system decoder and keeps web reads strict', async () => {
    window.__TAURI_INTERNALS__ = {};
    try {
      state.bytes = Uint8Array.from([0x63, 0x61, 0x66, 0xe9]);
      state.info.size = state.bytes.length;
      expect((await classifyFile('C:/workspace/sample.txt')).kind).toBe('text');
      expect(checkFileTextHead).toHaveBeenCalledWith('C:/workspace/sample.txt');
      expect(readFileHead).not.toHaveBeenCalled();
      expect((await classifyFile('web://workspace/sample.txt')).kind).toBe('invalid-encoding');
    } finally {
      delete window.__TAURI_INTERNALS__;
    }
  });

  it('short-circuits empty and oversized files without reading', async () => {
    state.info = { is_file: true, size: 0, modified: 1 };
    state.bytes = null;
    expect((await classifyFile('/tmp/empty')).kind).toBe('text');

    state.info = { is_file: true, size: 21 * 1024 * 1024, modified: 1 };
    expect((await classifyFile('/tmp/big')).kind).toBe('too-large');
    expect(readFileHead).not.toHaveBeenCalled();
  });

  it('never treats a failed or empty head read of a nonempty file as text', async () => {
    state.bytes = null;
    expect((await classifyFile('/tmp/denied')).kind).toBe('unreadable');
    readFileHead.mockRejectedValueOnce(new Error('denied'));
    expect((await classifyFile('/tmp/denied')).kind).toBe('unreadable');
    state.bytes = [];
    expect((await classifyFile('/tmp/denied')).kind).toBe('unreadable');
    getFileInfo.mockRejectedValueOnce(new Error('stat denied'));
    expect((await classifyFile('/tmp/denied')).kind).toBe('unreadable');
    state.info = { is_file: false, is_dir: true };
    expect((await classifyFile('/tmp/folder')).kind).toBe('not-file');
  });

  it('invalidates same-size replacements within the same second using millisecond metadata', async () => {
    state.info.modified_ms = 1001;
    expect((await classifyFile('/tmp/file')).kind).toBe('text');
    expect((await classifyFile('/tmp/file')).cached).toBe(true);
    state.info.modified_ms = 1002;
    state.bytes = [0, 1, 2];
    expect((await classifyFile('/tmp/file')).kind).toBe('binary');
    expect(readFileHead).toHaveBeenCalledTimes(2);
  });

  it('does not cache files without reliable modification metadata', async () => {
    state.info.modified = 0;
    expect((await classifyFile('/tmp/file')).kind).toBe('text');
    state.bytes = [0, 1, 2];
    expect((await classifyFile('/tmp/file')).kind).toBe('binary');
  });
});
