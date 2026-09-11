import { describe, it, expect } from 'vitest';
import { HEX_COLOR_PATTERN, isValidHex, normalizeHex } from '@/utils/hexColor';

// See specs/team-colors.md — the one colour format the app authors anywhere.
describe('isValidHex', () => {
  it('accepts six hex digits with a leading #', () => {
    expect(isValidHex('#ff5d6c')).toBe(true);
    expect(isValidHex('#FF5D6C')).toBe(true);
    expect(isValidHex('#000000')).toBe(true);
  });

  it('rejects every other notation', () => {
    // 3-digit shorthand and 8-digit alpha are deliberately out: the native
    // <input type="color"> emits neither, so accepting them would let the
    // swatch and the text field disagree.
    expect(isValidHex('#abc')).toBe(false);
    expect(isValidHex('#ff5d6cff')).toBe(false);
    expect(isValidHex('ff5d6c')).toBe(false);
    expect(isValidHex('#gggggg')).toBe(false);
    expect(isValidHex('rgb(255,0,0)')).toBe(false);
    expect(isValidHex('')).toBe(false);
  });

  it('rejects non-strings without throwing', () => {
    expect(isValidHex(undefined)).toBe(false);
    expect(isValidHex(null)).toBe(false);
    expect(isValidHex(0xff5d6c)).toBe(false);
    expect(isValidHex(['#ff5d6c'])).toBe(false);
  });

  it('anchors the pattern at both ends', () => {
    expect(HEX_COLOR_PATTERN.test(' #ff5d6c')).toBe(false);
    expect(HEX_COLOR_PATTERN.test('#ff5d6c ')).toBe(false);
  });
});

describe('normalizeHex', () => {
  it('lower-cases a valid value so re-picking the same colour is a no-op diff', () => {
    expect(normalizeHex('#FF5D6C')).toBe('#ff5d6c');
    expect(normalizeHex('#ff5d6c')).toBe('#ff5d6c');
  });

  it('returns an empty string for anything that is not a #rrggbb colour', () => {
    expect(normalizeHex('#abc')).toBe('');
    expect(normalizeHex('')).toBe('');
    expect(normalizeHex(undefined)).toBe('');
  });
});
