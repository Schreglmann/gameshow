import { describe, it, expect } from 'vitest';
import { JOKER_CATALOG, getJoker } from '@/data/jokers';

// A single emoji may be a ZWJ sequence or variation-selector joined;
// match "starts with Extended_Pictographic" and only emoji/VS/ZWJ after.
const EMOJI_RE = /^\p{Extended_Pictographic}(\uFE0F|\u200D\p{Extended_Pictographic})*$/u;

describe('Joker catalog', () => {
  it('has at least one entry', () => {
    expect(JOKER_CATALOG.length).toBeGreaterThan(0);
  });

  it('has unique ids', () => {
    const ids = JOKER_CATALOG.map(j => j.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every entry has non-empty id, name, description, icon', () => {
    for (const j of JOKER_CATALOG) {
      expect(j.id.trim()).not.toBe('');
      expect(j.name.trim()).not.toBe('');
      expect(j.description.trim()).not.toBe('');
      expect(j.icon.trim()).not.toBe('');
    }
  });

  it('every icon is a single emoji (no SVG, no text)', () => {
    for (const j of JOKER_CATALOG) {
      expect(j.icon, `${j.id} icon "${j.icon}" is not a single emoji`).toMatch(EMOJI_RE);
    }
  });

  it('ids are kebab-case', () => {
    for (const j of JOKER_CATALOG) {
      expect(j.id, `${j.id} is not kebab-case`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('getJoker returns catalog entry or undefined', () => {
    const first = JOKER_CATALOG[0];
    expect(getJoker(first.id)).toEqual(first);
    expect(getJoker('nope-no-such-joker')).toBeUndefined();
  });
});
