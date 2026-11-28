import { describe, it, expect } from 'vitest';
import { findInBin, normalizeBin, updateBin } from '@/utils/playerBin';
import { player } from '../../_helpers/players';

const anna = player('Anna', 'Müller', 'anna-mueller');
const ben = player('Ben', 'Bauer', 'ben-bauer');
const kiki = { id: 'kiki', firstName: '', lastName: '', nickname: 'Kiki', disabled: true };

describe('updateBin', () => {
  it('bins players who leave the registry, as they were', () => {
    expect(updateBin([], [anna, ben, kiki], [ben])).toEqual([anna, kiki]);
  });

  it('takes a player out who is back in the registry, by id or by identity', () => {
    expect(updateBin([anna, kiki], [ben], [ben, anna])).toEqual([kiki]);
    // Re-created with a new id under the same name: out of the bin too.
    expect(updateBin([anna], [], [{ ...anna, id: 'anna-mueller-2' }])).toEqual([]);
  });

  it('replaces an older bin entry with the same id', () => {
    const renamed = { ...anna, lastName: 'Meier' };
    expect(updateBin([anna], [renamed], [])).toEqual([renamed]);
  });

  it('returns the bin itself when nothing changes', () => {
    const bin = [anna];
    expect(updateBin(bin, [ben], [ben])).toBe(bin);
    expect(updateBin(bin, [], [])).toBe(bin);
  });
});

describe('normalizeBin / findInBin', () => {
  it('reads the file shape and drops broken entries', () => {
    expect(normalizeBin({ players: [anna, { id: 'x' }, 'Ben', kiki] })).toEqual([anna, kiki]);
    expect(normalizeBin(null)).toEqual([]);
    expect(normalizeBin({ players: 'nope' })).toEqual([]);
  });

  it('finds a binned player by full name, or by nickname for one without', () => {
    expect(findInBin([anna, kiki], 'anna', 'MÜLLER', 'Anna')).toBe(anna);
    expect(findInBin([anna, kiki], '', '', 'kiki')).toBe(kiki);
    expect(findInBin([anna, kiki], 'Anna', '', 'Anna')).toBeUndefined();
  });
});
