import { describe, it, expect } from 'vitest';
import { teamDisplayOrder } from '@/utils/teamOrder';

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
