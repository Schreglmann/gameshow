import { describe, it, expect } from 'vitest';
import {
  drawTeams,
  drawnPlayers,
  movePlayer,
  normalizePlayerName,
  parsePlayerNames,
  reconcileDraw,
  removePlayerByName,
} from '@/utils/teamDraw';
import type { TeamKey } from '@/utils/teams';

const TWO: TeamKey[] = ['team1', 'team2'];
const THREE: TeamKey[] = ['team1', 'team2', 'team3'];

/** Deterministic PRNG so placements are reproducible. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('normalizePlayerName / parsePlayerNames', () => {
  it('capitalizes every word', () => {
    expect(normalizePlayerName('john SMITH')).toBe('John Smith');
  });

  it('capitalizes every part of a double name', () => {
    expect(normalizePlayerName('anna-lena MÜLLER-lüdenscheidt')).toBe('Anna-Lena Müller-Lüdenscheidt');
  });

  it('splits on commas and newlines, trims and drops blanks', () => {
    expect(parsePlayerNames(' Anna, Ben\nCarla ,, \n')).toEqual(['Anna', 'Ben', 'Carla']);
  });
});

describe('drawTeams', () => {
  it('deals every player exactly once, balanced across the teams', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const patch = drawTeams(names, THREE, seeded(1));
    const sizes = THREE.map(k => patch[k]!.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(drawnPlayers(patch, THREE).sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  });

  it('returns an empty roster for every key when there are no names', () => {
    expect(drawTeams([], TWO)).toEqual({ team1: [], team2: [] });
  });

  it('returns nothing at zero teams', () => {
    expect(drawTeams(['a'], [])).toEqual({});
  });
});

describe('reconcileDraw', () => {
  it('draws fresh when every roster is empty', () => {
    const patch = reconcileDraw({ team1: [], team2: [] }, ['Anna', 'Ben', 'Carla', 'Dirk'], TWO, seeded(3));
    expect(patch!.team1!.length).toBe(2);
    expect(patch!.team2!.length).toBe(2);
  });

  it('returns null when the names match the draw (order and case ignored)', () => {
    const rosters = { team1: ['Anna', 'Carla'], team2: ['Ben'] };
    expect(reconcileDraw(rosters, ['ben', 'Carla', 'ANNA'], TWO)).toBeNull();
  });

  it('adds a new name to the smallest team without moving anyone else', () => {
    const rosters = { team1: ['Anna', 'Carla'], team2: ['Ben'] };
    const patch = reconcileDraw(rosters, ['Anna', 'Ben', 'Carla', 'dora'], TWO);
    expect(patch).toEqual({ team2: ['Ben', 'Dora'] });
  });

  it('breaks a size tie at random but keeps existing placements', () => {
    const rosters = { team1: ['Anna'], team2: ['Ben'] };
    const toTeam1 = reconcileDraw(rosters, ['Anna', 'Ben', 'Carla'], TWO, () => 0);
    const toTeam2 = reconcileDraw(rosters, ['Anna', 'Ben', 'Carla'], TWO, () => 0.99);
    expect(toTeam1).toEqual({ team1: ['Anna', 'Carla'] });
    expect(toTeam2).toEqual({ team2: ['Ben', 'Carla'] });
  });

  it('removes a name that is no longer listed and leaves the others', () => {
    const rosters = { team1: ['Anna', 'Carla'], team2: ['Ben', 'Dora'] };
    expect(reconcileDraw(rosters, ['Anna', 'Ben', 'Dora'], TWO)).toEqual({ team1: ['Anna'] });
  });

  it('treats duplicate names as separate players', () => {
    const rosters = { team1: ['Anna'], team2: ['Ben'] };
    const patch = reconcileDraw(rosters, ['Anna', 'Ben', 'Anna'], TWO, () => 0);
    expect(drawnPlayers({ ...rosters, ...patch }, TWO).filter(n => n === 'Anna')).toHaveLength(2);
    // And dropping one of the two removes exactly one.
    expect(reconcileDraw({ team1: ['Anna', 'Anna'], team2: ['Ben'] }, ['Anna', 'Ben'], TWO))
      .toEqual({ team1: ['Anna'] });
  });

  it('spreads several new names over the smallest teams', () => {
    const rosters = { team1: ['Anna', 'Ben'], team2: [], team3: ['Carla'] };
    const patch = reconcileDraw(rosters, ['Anna', 'Ben', 'Carla', 'Dora', 'Emil'], THREE, () => 0);
    const next = { ...rosters, ...patch };
    expect(next.team1).toEqual(['Anna', 'Ben']);
    expect(THREE.map(k => next[k]!.length).sort()).toEqual([1, 2, 2]);
  });

  it('returns null at zero teams', () => {
    expect(reconcileDraw({}, ['Anna'], [])).toBeNull();
  });
});

describe('movePlayer', () => {
  it('moves the named player to the end of the target team', () => {
    const rosters = { team1: ['Anna', 'Ben'], team2: ['Carla'] };
    expect(movePlayer(rosters, 'team1', 'Anna', 'team2')).toEqual({ team1: ['Ben'], team2: ['Carla', 'Anna'] });
  });

  it('returns null for an unknown player or the same team', () => {
    const rosters = { team1: ['Anna'], team2: [] };
    expect(movePlayer(rosters, 'team1', 'Zoe', 'team2')).toBeNull();
    expect(movePlayer(rosters, 'team1', 'Anna', 'team1')).toBeNull();
  });
});

describe('removePlayerByName', () => {
  it('removes one matching player, case-insensitively, wherever they are', () => {
    const rosters = { team1: ['Anna'], team2: ['Ben', 'Carla'] };
    expect(removePlayerByName(rosters, TWO, 'carla')).toEqual({ team2: ['Ben'] });
    expect(removePlayerByName({ team1: ['Anna', 'Anna'], team2: [] }, TWO, 'Anna')).toEqual({ team1: ['Anna'] });
  });

  it('returns null when nobody matches', () => {
    expect(removePlayerByName({ team1: ['Anna'], team2: [] }, TWO, 'Zoe')).toBeNull();
  });
});
