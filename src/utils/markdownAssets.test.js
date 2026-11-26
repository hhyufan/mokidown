import { describe, expect, it } from 'vitest';
import {
  isDataImageUri,
  markdownUrlTransform,
  rehypeNormalizeImageSrc,
} from './markdownAssets';

const imageNode = { tagName: 'img' };

describe('markdown base64 images', () => {
  it('recognizes data image URIs', () => {
    expect(isDataImageUri('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(isDataImageUri('data:image/svg+xml,<svg/>')).toBe(true);
    expect(isDataImageUri('data:text/html;base64,PGgxPg==')).toBe(false);
    expect(isDataImageUri('https://example.com/a.png')).toBe(false);
  });

  it('allows data images and local protocols through the URL transform', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    expect(markdownUrlTransform(dataUrl, 'src', imageNode)).toBe(dataUrl);
    expect(markdownUrlTransform('file:///C:/images/a.png', 'src', imageNode)).toBe(
      'file:///C:/images/a.png',
    );
    expect(markdownUrlTransform('data:text/html;base64,PGgxPg==', 'src', imageNode)).toBe('');
    expect(markdownUrlTransform('javascript:alert(1)', 'href', { tagName: 'a' })).toBe('');
    expect(markdownUrlTransform('https://example.com', 'href', { tagName: 'a' })).toBe(
      'https://example.com',
    );
  });

  it('normalizes Windows drive paths before sanitizing image sources', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'img',
          properties: { src: 'C:\\images\\a b.png' },
          children: [],
        },
      ],
    };
    rehypeNormalizeImageSrc()(tree);
    expect(tree.children[0].properties.src).toBe('file:///C:/images/a%20b.png');
  });
});
