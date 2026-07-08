import { describe, it, expect } from 'vitest';
import { teamName, isTeamNameLong, jokerColumns } from '@/utils/teamNames';
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

describe('jokerColumns', () => {
  it('mirrors the header grid layout (max 3 columns)', () => {
    expect(jokerColumns(0)).toBe(0);
    expect(jokerColumns(1)).toBe(1);
    expect(jokerColumns(2)).toBe(2);
    expect(jokerColumns(3)).toBe(3);
    expect(jokerColumns(4)).toBe(2);
    expect(jokerColumns(5)).toBe(3);
    expect(jokerColumns(6)).toBe(3);
    expect(jokerColumns(8)).toBe(3); // clamped to the 3-column max
  });
});

describe('isTeamNameLong', () => {
  // The real check measures an off-screen header replica; jsdom has no layout
  // (clientWidth 0), so it always returns false here. We assert the safe
  // behaviour: never warns for blank input, and never throws / warns without
  // layout. The truncation behaviour itself is verified in the browser.
  it('is false for undefined / blank / whitespace names', () => {
    expect(isTeamNameLong(undefined, 3)).toBe(false);
    expect(isTeamNameLong('', 3)).toBe(false);
    expect(isTeamNameLong('   ', 3)).toBe(false);
  });

  it('does not warn (and does not throw) without layout', () => {
    expect(isTeamNameLong('A very long team name indeed', 3)).toBe(false);
    expect(isTeamNameLong('w'.repeat(40), 0)).toBe(false);
  });
});
