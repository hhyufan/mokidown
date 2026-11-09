import { expect, it } from 'vitest';
import { buildReaderZoomUpdate } from './readerZoom';

it('zooms the editor and preview together while preserving line-height ratios', () => {
  expect(buildReaderZoomUpdate({
    previewZoomSync: true,
    fontSize: 14,
    lineHeight: 24,
    previewFontSize: 16,
    previewLineHeight: 30,
  }, 1)).toEqual({
    fontSize: 15,
    lineHeight: 26,
    previewFontSize: 17,
    previewLineHeight: 32,
  });
});

it('zooms only the reader preview when preview zoom is independent', () => {
  expect(buildReaderZoomUpdate({
    previewZoomSync: false,
    fontSize: 14,
    lineHeight: 24,
    previewFontSize: 16,
    previewLineHeight: 30,
  }, -1)).toEqual({ previewFontSize: 15, previewLineHeight: 28 });
});

it('clamps the reader zoom to the editor font-size limits', () => {
  expect(buildReaderZoomUpdate({ previewZoomSync: false, previewFontSize: 24, previewLineHeight: 36 }, 1))
    .toEqual({ previewFontSize: 24, previewLineHeight: 36 });
  expect(buildReaderZoomUpdate({ previewZoomSync: false, previewFontSize: 10, previewLineHeight: 18 }, -1))
    .toEqual({ previewFontSize: 10, previewLineHeight: 18 });
});
