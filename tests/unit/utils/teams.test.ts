import { describe, it, expect } from 'vitest';
import {
  ALL_TEAM_KEYS,
  DEFAULT_TEAM_COUNT,
  MAX_TEAMS,
  isTeamKey,
  leadingTeams,
  normalizeTeamCount,
  pointsByTeam,
  teamJokersUsed,
  teamKey,
  teamKeys,
  teamNumber,
  teamPoints,
  teamRoster,
  trailingTeams,
} from '@/utils/teams';
import type { TeamState } from '@/types/game';

/** A minimal two-team TeamState, as every pre-existing literal in the app looks. */
function twoTeams(partial: Partial<TeamState> = {}): TeamState {
  return {
    team1: [], team2: [],
    team1Points: 0, team2Points: 0,
    team1JokersUsed: [], team2JokersUsed: [],
    ...partial,
  };
}

describe('normalizeTeamCount', () => {
  it('passes through every valid count', () => {
    for (const n of [0, 1, 2, 3, 4]) expect(normalizeTeamCount(n)).toBe(n);
  });

  it('clamps out-of-range numbers instead of throwing', () => {
    expect(normalizeTeamCount(-3)).toBe(0);
    expect(normalizeTeamCount(99)).toBe(MAX_TEAMS);
  });

  it('falls back to the historic default for anything that is not an integer', () => {
    // Untrusted input: config.json, an API payload, a stale cached client.
    for (const bad of [undefined, null, '3', 2.5, NaN, {}, []]) {
      expect(normalizeTeamCount(bad)).toBe(DEFAULT_TEAM_COUNT);
    }
  });
});

describe('teamKeys / teamKey / teamNumber', () => {
  it('yields exactly the active teams, in identity order', () => {
    expect(teamKeys(0)).toEqual([]);
    expect(teamKeys(1)).toEqual(['team1']);
    expect(teamKeys(2)).toEqual(['team1', 'team2']);
    expect(teamKeys(3)).toEqual(['team1', 'team2', 'team3']);
    expect(teamKeys(4)).toEqual(['team1', 'team2', 'team3', 'team4']);
  });

  it('round-trips key ↔ number', () => {
    for (const key of ALL_TEAM_KEYS) expect(teamKey(teamNumber(key))).toBe(key);
  });

  it('clamps an out-of-range team number rather than returning undefined', () => {
    expect(teamKey(0)).toBe('team1');
    expect(teamKey(9)).toBe('team4');
  });

  it('narrows untrusted strings', () => {
    expect(isTeamKey('team3')).toBe(true);
    expect(isTeamKey('team5')).toBe(false);
    expect(isTeamKey('')).toBe(false);
    expect(isTeamKey(3)).toBe(false);
    expect(isTeamKey(undefined)).toBe(false);
  });
});

describe('tolerant accessors', () => {
  it('reads an absent team as empty, never undefined', () => {
    // This is the whole reason team3/team4 may be optional on TeamState: a
    // two-team state literal must stay valid and read as zeroes for teams 3-4.
    const teams = twoTeams();
    expect(teamPoints(teams, 'team3')).toBe(0);
    expect(teamRoster(teams, 'team4')).toEqual([]);
    expect(teamJokersUsed(teams, 'team3')).toEqual([]);
  });

  it('reads a present team normally', () => {
    const teams = twoTeams({ team3: ['Ida'], team3Points: 7, team3JokersUsed: ['comeback'] });
    expect(teamRoster(teams, 'team3')).toEqual(['Ida']);
    expect(teamPoints(teams, 'team3')).toBe(7);
    expect(teamJokersUsed(teams, 'team3')).toEqual(['comeback']);
  });

  it('treats a corrupt points value as 0 rather than propagating NaN', () => {
    // A NaN total used to flow through applyPointDelta and stick for the show.
    const teams = twoTeams({ team1Points: NaN as unknown as number });
    expect(teamPoints(teams, 'team1')).toBe(0);
  });

  it('pointsByTeam always covers all four keys, zeroing the inactive ones', () => {
    const teams = twoTeams({ team1Points: 5, team2Points: 3, team3Points: 99 });
    expect(pointsByTeam(teams, teamKeys(2))).toEqual({ team1: 5, team2: 3, team3: 0, team4: 0 });
  });
});

describe('leadingTeams / trailingTeams', () => {
  const teams = (...pts: number[]) => twoTeams({
    team1Points: pts[0] ?? 0, team2Points: pts[1] ?? 0,
    team3Points: pts[2] ?? 0, team4Points: pts[3] ?? 0,
  });

  it('matches the historic two-team rule exactly', () => {
    // Aufholjoker: only the strictly-behind team may spend it; nobody on a draw.
    expect(trailingTeams(teams(5, 3), teamKeys(2))).toEqual(['team2']);
    expect(trailingTeams(teams(3, 5), teamKeys(2))).toEqual(['team1']);
    expect(trailingTeams(teams(4, 4), teamKeys(2))).toEqual([]);
    expect(leadingTeams(teams(5, 3), teamKeys(2))).toEqual(['team1']);
    expect(leadingTeams(teams(4, 4), teamKeys(2))).toEqual(['team1', 'team2']);
  });

  it('generalizes to "everyone below the leader" at 3-4 teams', () => {
    expect(trailingTeams(teams(9, 3, 5, 1), teamKeys(4))).toEqual(['team2', 'team3', 'team4']);
    expect(leadingTeams(teams(9, 3, 5, 1), teamKeys(4))).toEqual(['team1']);
  });

  it('treats a tie for the lead as several leaders and no extra trailers', () => {
    expect(leadingTeams(teams(7, 7, 2), teamKeys(3))).toEqual(['team1', 'team2']);
    expect(trailingTeams(teams(7, 7, 2), teamKeys(3))).toEqual(['team3']);
  });

  it('has nobody trailing when every active team is level', () => {
    expect(trailingTeams(teams(2, 2, 2, 2), teamKeys(4))).toEqual([]);
  });

  it('ignores inactive teams entirely', () => {
    // team3 holds points from an earlier 3-team show; a 2-team show must not see it.
    expect(leadingTeams(teams(1, 2, 100), teamKeys(2))).toEqual(['team2']);
    expect(trailingTeams(teams(1, 2, 100), teamKeys(2))).toEqual(['team1']);
  });

  it('returns nothing at 0 teams', () => {
    expect(leadingTeams(teams(), [])).toEqual([]);
    expect(trailingTeams(teams(), [])).toEqual([]);
  });

  it('counts a single team as leading, but never trailing', () => {
    expect(leadingTeams(teams(4), teamKeys(1))).toEqual(['team1']);
    expect(trailingTeams(teams(4), teamKeys(1))).toEqual([]);
  });
});
