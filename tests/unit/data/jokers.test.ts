import { describe, it, expect } from 'vitest';
import { JOKER_CATALOG, getJoker } from '@/data/jokers';
import { hasJokerIcon } from '@/components/common/JokerIcon';

describe('Joker catalog', () => {
  it('has at least one entry', () => {
    expect(JOKER_CATALOG.length).toBeGreaterThan(0);
  });

  it('has unique ids', () => {
    const ids = JOKER_CATALOG.map(j => j.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every entry has non-empty id, name, description', () => {
    for (const j of JOKER_CATALOG) {
      expect(j.id.trim()).not.toBe('');
      expect(j.name.trim()).not.toBe('');
      expect(j.description.trim()).not.toBe('');
    }
  });

  it('ids are kebab-case', () => {
    for (const j of JOKER_CATALOG) {
      expect(j.id, `${j.id} is not kebab-case`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('every catalog entry has an SVG icon registered', () => {
    for (const j of JOKER_CATALOG) {
      expect(hasJokerIcon(j.id), `no icon registered for "${j.id}" — add it to BASE_ICONS in JokerIcon.tsx`).toBe(true);
    }
  });

  it('getJoker returns catalog entry or undefined', () => {
    const first = JOKER_CATALOG[0];
    expect(getJoker(first.id)).toEqual(first);
    expect(getJoker('nope-no-such-joker')).toBeUndefined();
  });
});
