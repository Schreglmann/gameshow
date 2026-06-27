import { describe, it, expect } from 'vitest';
import { teamName, isTeamNameLong, TEAM_NAME_SOFT_LIMIT } from '@/utils/teamNames';
import type { TeamState } from '@/types/game';

function teams(partial: Partial<TeamState>): TeamState {
  return {
    team1: [],
    team2: [],
    team1Points: 0,
    team2Points: 0,
    team1JokersUsed: [],
    team2JokersUsed: [],
    ...partial,
  };
}

describe('teamName', () => {
  it('falls back to positional labels when no name is set', () => {
    expect(teamName(teams({}), 1)).toBe('Team 1');
    expect(teamName(teams({}), 2)).toBe('Team 2');
  });

  it('returns the custom name when set', () => {
    const t = teams({ team1Name: 'Die Adler', team2Name: 'Quizfüchse' });
    expect(teamName(t, 1)).toBe('Die Adler');
    expect(teamName(t, 2)).toBe('Quizfüchse');
  });

  it('falls back when the name is blank or whitespace only', () => {
    expect(teamName(teams({ team1Name: '' }), 1)).toBe('Team 1');
    expect(teamName(teams({ team2Name: '   ' }), 2)).toBe('Team 2');
  });
});

describe('isTeamNameLong', () => {
  it('is false for undefined, blank, and short names', () => {
    expect(isTeamNameLong(undefined)).toBe(false);
    expect(isTeamNameLong('')).toBe(false);
    expect(isTeamNameLong('   ')).toBe(false);
    expect(isTeamNameLong('Die Adler')).toBe(false);
  });

  it('is false at exactly the soft limit and true just above it', () => {
    expect(isTeamNameLong('x'.repeat(TEAM_NAME_SOFT_LIMIT))).toBe(false);
    expect(isTeamNameLong('x'.repeat(TEAM_NAME_SOFT_LIMIT + 1))).toBe(true);
  });

  it('measures the trimmed length', () => {
    expect(isTeamNameLong(`  ${'x'.repeat(TEAM_NAME_SOFT_LIMIT)}  `)).toBe(false);
  });
});
