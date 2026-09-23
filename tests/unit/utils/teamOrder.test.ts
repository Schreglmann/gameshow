import { describe, it, expect } from 'vitest';
import { teamDisplayOrder, splitAroundCenter } from '@/utils/teamOrder';

describe('teamDisplayOrder', () => {
  it('frontend (mirror=false): team1 left when not swapped', () => {
    expect(teamDisplayOrder(false, false)).toEqual(['team1', 'team2']);
    expect(teamDisplayOrder(undefined, false)).toEqual(['team1', 'team2']);
  });

  it('frontend (mirror=false): team2 left when swapped', () => {
    expect(teamDisplayOrder(true, false)).toEqual(['team2', 'team1']);
  });

  it('gamemaster (mirror=true): always the reverse of the frontend order', () => {
    // Not swapped → frontend [team1, team2] → GM mirror [team2, team1]
    expect(teamDisplayOrder(false, true)).toEqual(['team2', 'team1']);
    expect(teamDisplayOrder(undefined, true)).toEqual(['team2', 'team1']);
    // Swapped → frontend [team2, team1] → GM mirror [team1, team2]
    expect(teamDisplayOrder(true, true)).toEqual(['team1', 'team2']);
  });

  it('defaults mirror to false', () => {
    expect(teamDisplayOrder(false)).toEqual(['team1', 'team2']);
    expect(teamDisplayOrder(true)).toEqual(['team2', 'team1']);
  });

  it('GM order is always the exact reverse of the frontend order', () => {
    for (const swapped of [true, false, undefined]) {
      const frontend = teamDisplayOrder(swapped, false);
      const gm = teamDisplayOrder(swapped, true);
      expect(gm).toEqual([frontend[1], frontend[0]]);
    }
  });

  it('enabled=false forces natural [team1, team2] regardless of swap/mirror', () => {
    for (const swapped of [true, false, undefined]) {
      for (const mirror of [true, false]) {
        expect(teamDisplayOrder(swapped, mirror, false)).toEqual(['team1', 'team2']);
      }
    }
  });

  it('enabled defaults to true (mirror/swap active)', () => {
    expect(teamDisplayOrder(true, false, true)).toEqual(['team2', 'team1']);
    expect(teamDisplayOrder(false, true, true)).toEqual(['team2', 'team1']);
  });
});

// ── Dynamic team count (0–4) ──
// The regression bar: at two teams the generalized helper must return exactly
// what the previous fixed 2-tuple implementation returned, for every input.
// See specs/team-count.md.
describe('teamDisplayOrder — N teams', () => {
  it('returns exactly the active teams', () => {
    expect(teamDisplayOrder(false, false, true, 0)).toEqual([]);
    expect(teamDisplayOrder(false, false, true, 1)).toEqual(['team1']);
    expect(teamDisplayOrder(false, false, true, 3)).toEqual(['team1', 'team2', 'team3']);
    expect(teamDisplayOrder(false, false, true, 4)).toEqual(['team1', 'team2', 'team3', 'team4']);
  });

  it('reverses the whole list on a seating swap, and mirrors it again for the GM', () => {
    const four = ['team1', 'team2', 'team3', 'team4'];
    const reversed = ['team4', 'team3', 'team2', 'team1'];
    expect(teamDisplayOrder(true, false, true, 4)).toEqual(reversed);   // show, swapped
    expect(teamDisplayOrder(false, true, true, 4)).toEqual(reversed);   // GM, unswapped
    expect(teamDisplayOrder(true, true, true, 4)).toEqual(four);        // GM, swapped → cancels
  });

  it('forces the natural order at every count while the feature is off', () => {
    for (const count of [1, 2, 3, 4]) {
      for (const swapped of [true, false]) {
        for (const mirror of [true, false]) {
          expect(teamDisplayOrder(swapped, mirror, false, count))
            .toEqual(['team1', 'team2', 'team3', 'team4'].slice(0, count));
        }
      }
    }
  });

  it('defaults to two teams when no count is given (every legacy call site)', () => {
    expect(teamDisplayOrder(false)).toEqual(['team1', 'team2']);
    expect(teamDisplayOrder(true)).toEqual(['team2', 'team1']);
    expect(teamDisplayOrder(false, true)).toEqual(['team2', 'team1']);
  });

  it('never reverses a single team', () => {
    expect(teamDisplayOrder(true, false, true, 1)).toEqual(['team1']);
    expect(teamDisplayOrder(true, true, true, 1)).toEqual(['team1']);
  });
});

describe('splitAroundCenter — the header layout', () => {
  it('keeps the historic 1 / counter / 1 split at two teams', () => {
    expect(splitAroundCenter(['team1', 'team2'])).toEqual({ left: ['team1'], right: ['team2'] });
  });

  it('puts the odd team on the LEFT at three teams', () => {
    expect(splitAroundCenter(['team1', 'team2', 'team3']))
      .toEqual({ left: ['team1', 'team2'], right: ['team3'] });
  });

  it('splits four teams evenly', () => {
    expect(splitAroundCenter(['team1', 'team2', 'team3', 'team4']))
      .toEqual({ left: ['team1', 'team2'], right: ['team3', 'team4'] });
  });

  it('leaves the right side empty for a single team, and both for none', () => {
    expect(splitAroundCenter(['team1'])).toEqual({ left: ['team1'], right: [] });
    expect(splitAroundCenter([])).toEqual({ left: [], right: [] });
  });

  it('follows the given order, so a swap moves teams across the counter', () => {
    expect(splitAroundCenter(['team4', 'team3', 'team2', 'team1']))
      .toEqual({ left: ['team4', 'team3'], right: ['team2', 'team1'] });
  });
});
