import { describe, it, expect } from 'vitest';
import { encodeAssetPath, assetUrl, toMediaSrc } from '@/utils/assetUrl';

describe('encodeAssetPath', () => {
  it('encodes a "#" so the URL is not truncated at the fragment', () => {
    const name = 'Armin van Buuren - … [Live at Unfiltered #3].mp4';
    const encoded = encodeAssetPath(name);
    expect(encoded).not.toContain('#');
    expect(encoded).toContain('%23');
    // Round-trips back to the original filename (what the server decodes).
    expect(decodeURIComponent(encoded)).toBe(name);
  });

  it('preserves "/" path separators while encoding each segment', () => {
    expect(encodeAssetPath('Soundtracks/Live #3/clip.mp4'))
      .toBe('Soundtracks/Live%20%233/clip.mp4');
  });

  it('encodes other URL-hostile characters (?, &, spaces)', () => {
    expect(encodeAssetPath('a b?c&d.mp4')).toBe('a%20b%3Fc%26d.mp4');
  });

  it('leaves plain filenames unchanged', () => {
    expect(encodeAssetPath('Matthew-Mercer.jpg')).toBe('Matthew-Mercer.jpg');
  });

  it('assetUrl prefixes the category and encodes the path', () => {
    expect(assetUrl('videos', '[Live #3].mp4')).toBe('/videos/%5BLive%20%233%5D.mp4');
  });
});

describe('toMediaSrc', () => {
  it('encodes a local "/category/file" path (including "#")', () => {
    expect(toMediaSrc('/audio/Song #1.mp3')).toBe('/audio/Song%20%231.mp3');
    expect(toMediaSrc('/images/Foo #3.jpg')).toBe('/images/Foo%20%233.jpg');
  });

  it('passes absolute URLs through untouched (would corrupt the scheme otherwise)', () => {
    expect(toMediaSrc('https://i.ytimg.com/vi/abc/hq.jpg')).toBe('https://i.ytimg.com/vi/abc/hq.jpg');
    expect(toMediaSrc('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(toMediaSrc('blob:http://x/123')).toBe('blob:http://x/123');
  });

  it('passes undefined through', () => {
    expect(toMediaSrc(undefined)).toBeUndefined();
  });
});
