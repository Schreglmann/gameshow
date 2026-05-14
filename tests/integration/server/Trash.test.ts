import { describe, it, expect } from 'vitest';
import {
  TRASH_BATCH_ID_RE,
  assertSafeTrashOriginalPath,
  mediaTypeFromPath,
} from '../../../server/trash-helpers';

/**
 * Trash-helper unit tests. Path validation is the trust boundary the trash
 * routes lean on — if these silently accept `..` or `.trash` segments, every
 * trash endpoint becomes a path-traversal sink. End-to-end behaviour of the
 * routes themselves is covered by the contract test + manual Playwright pass.
 */

describe('Trash helpers — path safety', () => {
  it('rejects empty / non-string paths', () => {
    expect(() => assertSafeTrashOriginalPath('')).toThrow();
    // @ts-expect-error — type-narrowing isn't the point; we want the runtime check
    expect(() => assertSafeTrashOriginalPath(null)).toThrow();
    // @ts-expect-error — same
    expect(() => assertSafeTrashOriginalPath(undefined)).toThrow();
  });

  it('rejects `..` traversal anywhere in the path', () => {
    expect(() => assertSafeTrashOriginalPath('..')).toThrow();
    expect(() => assertSafeTrashOriginalPath('a/..')).toThrow();
    expect(() => assertSafeTrashOriginalPath('a/../b')).toThrow();
    expect(() => assertSafeTrashOriginalPath('foo..bar')).toThrow(); // conservative — substring match
  });

  it('rejects NUL bytes', () => {
    expect(() => assertSafeTrashOriginalPath('foo\0bar.jpg')).toThrow();
  });

  it('rejects dot-prefixed segments (no targeting .trash, hidden caches, etc.)', () => {
    expect(() => assertSafeTrashOriginalPath('.trash/x.jpg')).toThrow();
    expect(() => assertSafeTrashOriginalPath('a/.hidden/x.jpg')).toThrow();
    expect(() => assertSafeTrashOriginalPath('.foo')).toThrow();
  });

  it('rejects empty segments (double slashes)', () => {
    expect(() => assertSafeTrashOriginalPath('a//b')).toThrow();
    expect(() => assertSafeTrashOriginalPath('/a')).toThrow();
  });

  it('accepts ordinary nested paths', () => {
    expect(() => assertSafeTrashOriginalPath('Mercer.jpg')).not.toThrow();
    expect(() => assertSafeTrashOriginalPath('Personen/Mercer.jpg')).not.toThrow();
    expect(() => assertSafeTrashOriginalPath('a/b/c/d.mp4')).not.toThrow();
  });
});

describe('Trash helpers — batchId regex', () => {
  it('accepts the timestamp + uuid format the DELETE handler mints', () => {
    expect(TRASH_BATCH_ID_RE.test('1715000000000-abcd1234')).toBe(true);
    expect(TRASH_BATCH_ID_RE.test('c00c1bd3-d8d8-4b96-a337-a72d1245bfd9')).toBe(true);
  });

  it('rejects path-traversal payloads', () => {
    expect(TRASH_BATCH_ID_RE.test('..')).toBe(false);
    expect(TRASH_BATCH_ID_RE.test('../../etc')).toBe(false);
    expect(TRASH_BATCH_ID_RE.test('a/b')).toBe(false);
  });

  it('rejects too-short or empty values', () => {
    expect(TRASH_BATCH_ID_RE.test('')).toBe(false);
    expect(TRASH_BATCH_ID_RE.test('short')).toBe(false); // 5 chars
    expect(TRASH_BATCH_ID_RE.test('abcdef')).toBe(true);  // 6 chars
  });

  it('rejects too-long values', () => {
    expect(TRASH_BATCH_ID_RE.test('a'.repeat(64))).toBe(true);
    expect(TRASH_BATCH_ID_RE.test('a'.repeat(65))).toBe(false);
  });

  it('rejects unsafe characters', () => {
    expect(TRASH_BATCH_ID_RE.test('abc def')).toBe(false);
    expect(TRASH_BATCH_ID_RE.test('abc/def')).toBe(false);
    expect(TRASH_BATCH_ID_RE.test('abc.def')).toBe(false);
    expect(TRASH_BATCH_ID_RE.test('abc!def')).toBe(false);
  });
});

describe('Trash helpers — mediaTypeFromPath', () => {
  it('classifies image extensions', () => {
    expect(mediaTypeFromPath('Mercer.jpg', false)).toBe('image');
    expect(mediaTypeFromPath('a/b/c.PNG', false)).toBe('image');
    expect(mediaTypeFromPath('foo.webp', false)).toBe('image');
    expect(mediaTypeFromPath('foo.svg', false)).toBe('image');
  });

  it('classifies audio extensions', () => {
    expect(mediaTypeFromPath('track.mp3', false)).toBe('audio');
    expect(mediaTypeFromPath('track.M4A', false)).toBe('audio');
    expect(mediaTypeFromPath('track.flac', false)).toBe('audio');
  });

  it('classifies video extensions', () => {
    expect(mediaTypeFromPath('clip.mp4', false)).toBe('video');
    expect(mediaTypeFromPath('clip.MKV', false)).toBe('video');
    expect(mediaTypeFromPath('clip.mov', false)).toBe('video');
  });

  it('returns "other" for directories regardless of extension', () => {
    expect(mediaTypeFromPath('Personen.jpg', true)).toBe('other');
    expect(mediaTypeFromPath('downloads', true)).toBe('other');
  });

  it('returns "other" for unknown extensions and no extension', () => {
    expect(mediaTypeFromPath('foo.bin', false)).toBe('other');
    expect(mediaTypeFromPath('README', false)).toBe('other');
  });
});
