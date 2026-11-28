import { describe, it, expect } from 'vitest';
import {
  applyPlayerRenames,
  drawTeams,
  drawnPlayers,
  movePlayer,
  normalizePlayerName,
  reconcileDraw,
  removePlayer,
} from '@/utils/teamDraw';
import { fullName } from '@/utils/playerNames';
import type { TeamKey } from '@/utils/teams';
import { names, player, rp, rpOf, typed } from '../../_helpers/players';

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

describe('normalizePlayerName (re-exported from playerNames)', () => {
  it('capitalizes every word', () => {
    expect(normalizePlayerName('john SMITH')).toBe('John Smith');
  });

  it('capitalizes every part of a double name', () => {
    expect(normalizePlayerName('anna-lena MÜLLER-lüdenscheidt')).toBe('Anna-Lena Müller-Lüdenscheidt');
  });
});

describe('drawTeams', () => {
  it('deals every player exactly once, balanced across the teams', () => {
    const players = names('A', 'B', 'C', 'D', 'E', 'F', 'G');
    const patch = drawTeams(players, THREE, seeded(1));
    const sizes = THREE.map(k => patch[k]!.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(drawnPlayers(patch, THREE).map(fullName).sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  });

  it('keeps the player objects (ids included) as given', () => {
    const anna = player('Anna', 'Müller', 'anna-mueller');
    const patch = drawTeams([anna], TWO, () => 0);
    expect(drawnPlayers(patch, TWO)).toEqual([anna]);
  });

  it('returns an empty roster for every key when there are no players', () => {
    expect(drawTeams([], TWO)).toEqual({ team1: [], team2: [] });
  });

  it('returns nothing at zero teams', () => {
    expect(drawTeams(names('a'), [])).toEqual({});
  });
});

describe('reconcileDraw', () => {
  it('draws fresh when every roster is empty', () => {
    const patch = reconcileDraw({ team1: [], team2: [] }, names('Anna', 'Ben', 'Carla', 'Dirk'), TWO, seeded(3));
    expect(patch!.team1!.length).toBe(2);
    expect(patch!.team2!.length).toBe(2);
  });

  it('returns null when the players match the draw (order ignored)', () => {
    const rosters = { team1: names('Anna', 'Carla'), team2: names('Ben') };
    expect(reconcileDraw(rosters, names('Ben', 'Carla', 'Anna'), TWO)).toBeNull();
  });

  it('adds a new player to the smallest team without moving anyone else', () => {
    const rosters = { team1: names('Anna', 'Carla'), team2: names('Ben') };
    const patch = reconcileDraw(rosters, names('Anna', 'Ben', 'Carla', 'Dora'), TWO);
    expect(patch).toEqual({ team2: names('Ben', 'Dora') });
  });

  it('breaks a size tie at random but keeps existing placements', () => {
    const rosters = { team1: names('Anna'), team2: names('Ben') };
    const toTeam1 = reconcileDraw(rosters, names('Anna', 'Ben', 'Carla'), TWO, () => 0);
    const toTeam2 = reconcileDraw(rosters, names('Anna', 'Ben', 'Carla'), TWO, () => 0.99);
    expect(toTeam1).toEqual({ team1: names('Anna', 'Carla') });
    expect(toTeam2).toEqual({ team2: names('Ben', 'Carla') });
  });

  it('removes a player who is no longer listed and leaves the others', () => {
    const rosters = { team1: names('Anna', 'Carla'), team2: names('Ben', 'Dora') };
    expect(reconcileDraw(rosters, names('Anna', 'Ben', 'Dora'), TWO)).toEqual({ team1: names('Anna') });
  });

  it('tells two players with the same first name apart by surname', () => {
    const rosters = { team1: [rp('Michi', 'Huber')], team2: [] };
    const patch = reconcileDraw(rosters, [rp('Michi', 'Huber'), rp('Michi', 'Pichler')], TWO, () => 0);
    expect(patch).toEqual({ team2: [rp('Michi', 'Pichler')] });
  });

  it('keeps legacy duplicates in a roster — neither one silently vanishes', () => {
    const rosters = { team1: names('Anna', 'Anna'), team2: names('Ben') };
    expect(reconcileDraw(rosters, names('Anna', 'Anna', 'Ben'), TWO)).toBeNull();
    // Dropping one of the two removes exactly one.
    expect(reconcileDraw(rosters, names('Anna', 'Ben'), TWO)).toEqual({ team1: names('Anna') });
  });

  it('replaces a kept entry with the listed object: a rename or a registry id reaches the draw', () => {
    const rosters = { team1: [rp('anna', 'müller')], team2: names('Ben') };
    const anna = player('Anna', 'Müller', 'anna-mueller');
    const patch = reconcileDraw(rosters, [anna, rp('Ben')], TWO);
    expect(patch).toEqual({ team1: [anna] });
  });

  it('matches by id, so a renamed registry player keeps their team', () => {
    const rosters = { team1: [rp('Anna', 'Müller', 'anna-mueller')], team2: names('Ben') };
    const renamed = player('Anna', 'Meier', 'anna-mueller');
    expect(reconcileDraw(rosters, [renamed, rp('Ben')], TWO)).toEqual({ team1: [renamed] });
  });

  it('spreads several new players over the smallest teams', () => {
    const rosters = { team1: names('Anna', 'Ben'), team2: [], team3: names('Carla') };
    const patch = reconcileDraw(rosters, names('Anna', 'Ben', 'Carla', 'Dora', 'Emil'), THREE, () => 0);
    const next = { ...rosters, ...patch };
    expect(next.team1).toEqual(names('Anna', 'Ben'));
    expect(THREE.map(k => next[k]!.length).sort()).toEqual([1, 2, 2]);
  });

  it('returns null at zero teams', () => {
    expect(reconcileDraw({}, names('Anna'), [])).toBeNull();
  });
});

describe('movePlayer', () => {
  it('moves the player to the end of the target team', () => {
    const rosters = { team1: names('Anna', 'Ben'), team2: names('Carla') };
    expect(movePlayer(rosters, 'team1', rp('Anna'), 'team2'))
      .toEqual({ team1: names('Ben'), team2: names('Carla', 'Anna') });
  });

  it('finds the player by identity, not by exact object', () => {
    const anna = rp('Anna', 'Müller', 'anna-mueller');
    const rosters = { team1: [anna], team2: [] };
    expect(movePlayer(rosters, 'team1', rp('Anna', 'Meier', 'anna-mueller'), 'team2'))
      .toEqual({ team1: [], team2: [anna] });
  });

  it('returns null for an unknown player or the same team', () => {
    const rosters = { team1: names('Anna'), team2: [] };
    expect(movePlayer(rosters, 'team1', rp('Zoe'), 'team2')).toBeNull();
    expect(movePlayer(rosters, 'team1', rp('Anna'), 'team1')).toBeNull();
  });
});

describe('removePlayer', () => {
  it('removes one matching player, case-insensitively, wherever they are', () => {
    const rosters = { team1: names('Anna'), team2: names('Ben', 'Carla') };
    expect(removePlayer(rosters, TWO, rp('carla'))).toEqual({ team2: names('Ben') });
    expect(removePlayer({ team1: names('Anna', 'Anna'), team2: [] }, TWO, rp('Anna'))).toEqual({ team1: names('Anna') });
  });

  it('does not confuse two players with the same first name', () => {
    const rosters = { team1: [rp('Michi', 'Huber'), rp('Michi', 'Pichler')], team2: [] };
    expect(removePlayer(rosters, TWO, rp('Michi', 'Pichler'))).toEqual({ team1: [rp('Michi', 'Huber')] });
  });

  it('returns null when nobody matches', () => {
    expect(removePlayer({ team1: names('Anna'), team2: [] }, TWO, rp('Zoe'))).toBeNull();
  });
});

describe('applyPlayerRenames', () => {
  it('updates drawn registry players whose names changed', () => {
    const carla = player('Carla', 'Weber', 'carla-weber');
    const rosters = { team1: [rpOf(player('Anna', 'Müller', 'anna-mueller')), rp('Ben')], team2: [rpOf(carla)] };
    const patch = applyPlayerRenames(rosters, [player('Anna', 'Meier', 'anna-mueller'), carla], TWO);
    expect(patch).toEqual({ team1: [rpOf(player('Anna', 'Meier', 'anna-mueller')), rp('Ben')] });
  });

  it('carries a nickname change', () => {
    const rosters = { team1: [rpOf(player('Michael', 'Huber', 'mh'))], team2: [] };
    expect(applyPlayerRenames(rosters, [player('Michael', 'Huber', 'mh', 'Michi')], TWO))
      .toEqual({ team1: [rpOf(player('Michael', 'Huber', 'mh', 'Michi'))] });
  });

  it('leaves ad-hoc players and unlisted ids alone and returns null without a change', () => {
    const rosters = { team1: [rp('Anna', 'Müller'), rp('Ben', 'Bauer', 'gone')], team2: [] };
    expect(applyPlayerRenames(rosters, [player('Anna', 'Meier', 'anna-mueller')], TWO)).toBeNull();
  });

  it('gives a live-added name the id of the listed player it now is', () => {
    const kiki = { id: 'kiki', firstName: '', lastName: '', nickname: 'Kiki' };
    const rosters = { team1: [rp('Ben', 'Bauer')], team2: [typed('Kiki'), typed('Zoe')] };
    expect(applyPlayerRenames(rosters, [kiki], TWO)).toEqual({ team2: [typed('Kiki', 'kiki'), typed('Zoe')] });
  });
});
