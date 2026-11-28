import { describe, it, expect } from 'vitest';
import { dataUrlToFile, parseSingleHttpUrl, readPastedImage } from '@/utils/clipboardImage';

// 1×1 transparent PNG.
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function clipboard(opts: { files?: File[]; text?: string }): DataTransfer {
  return {
    items: (opts.files ?? []).map(f => ({ kind: 'file', type: f.type, getAsFile: () => f })),
    getData: (type: string) => (type === 'text/plain' ? opts.text ?? '' : ''),
  } as unknown as DataTransfer;
}

describe('parseSingleHttpUrl', () => {
  it('accepts a single http(s) URL, trimmed', () => {
    expect(parseSingleHttpUrl('  https://example.com/ab.jpg')).toBe('https://example.com/ab.jpg');
    expect(parseSingleHttpUrl('http://example.com/x.png\n')).toBe('http://example.com/x.png');
  });

  it('rejects text, other protocols and several URLs', () => {
    expect(parseSingleHttpUrl('Matthew Mercer')).toBeNull();
    expect(parseSingleHttpUrl('ftp://example.com/x.png')).toBeNull();
    expect(parseSingleHttpUrl('javascript:alert(1)')).toBeNull();
    expect(parseSingleHttpUrl('https://a.com/1.jpg https://b.com/2.jpg')).toBeNull();
    expect(parseSingleHttpUrl('')).toBeNull();
  });
});

describe('dataUrlToFile', () => {
  it('decodes a base64 image data URL', () => {
    const f = dataUrlToFile(PNG_DATA_URL)!;
    expect(f.type).toBe('image/png');
    expect(f.name).toBe('image.png');
    expect(f.size).toBeGreaterThan(0);
  });

  it('returns null for non-image or non-base64 data URLs', () => {
    expect(dataUrlToFile('data:text/plain;base64,aGFsbG8=')).toBeNull();
    expect(dataUrlToFile('data:image/svg+xml,<svg/>')).toBeNull();
    expect(dataUrlToFile('https://example.com/x.png')).toBeNull();
  });
});

describe('readPastedImage', () => {
  it('prefers a clipboard image file over text', () => {
    const file = new File(['x'], 'image.png', { type: 'image/png' });
    expect(readPastedImage(clipboard({ files: [file], text: 'https://example.com/x.png' }))).toEqual({ kind: 'file', file });
  });

  it('turns a data:image URL into a file', () => {
    const result = readPastedImage(clipboard({ text: PNG_DATA_URL }));
    expect(result?.kind).toBe('file');
  });

  it('turns a single URL into a URL candidate', () => {
    expect(readPastedImage(clipboard({ text: 'https://example.com/x.png' }))).toEqual({ kind: 'url', url: 'https://example.com/x.png' });
  });

  it('ignores plain text, non-image files and missing clipboard data', () => {
    expect(readPastedImage(clipboard({ text: 'hallo' }))).toBeNull();
    expect(readPastedImage(clipboard({ files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] }))).toBeNull();
    expect(readPastedImage(null)).toBeNull();
  });
});
