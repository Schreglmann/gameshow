import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { teamName, isTeamNameLong, jokerColumns, buildHeaderReplica, teamNameLongHint } from '@/utils/teamNames';
import { GameProvider } from '@/context/GameContext';
import { ThemeProvider } from '@/context/ThemeContext';
import Header from '@/components/layout/Header';
import type { TeamState } from '@/types/game';

const fetchSettings = vi.fn();
vi.mock('@/services/api', () => ({
  fetchSettings: (...a: unknown[]) => fetchSettings(...a),
  // `JokerIcon` reads the theme, so the header renders inside a ThemeProvider.
  fetchTheme: vi.fn().mockResolvedValue({ theme: 'galaxia' }),
  saveTheme: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/services/useBackendSocket', () => ({
  sendWs: () => true,
  onWsOpen: () => () => {},
  useWsChannel: () => {},
}));

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
    expect(teamName(teams({}), 'team1')).toBe('Team 1');
    expect(teamName(teams({}), 'team2')).toBe('Team 2');
  });

  it('returns the custom name when set', () => {
    const t = teams({ team1Name: 'Die Adler', team2Name: 'Quizfüchse' });
    expect(teamName(t, 'team1')).toBe('Die Adler');
    expect(teamName(t, 'team2')).toBe('Quizfüchse');
  });

  it('falls back when the name is blank or whitespace only', () => {
    expect(teamName(teams({ team1Name: '' }), 'team1')).toBe('Team 1');
    expect(teamName(teams({ team2Name: '   ' }), 'team2')).toBe('Team 2');
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

describe('teamNameLongHint', () => {
  it('names the joker count only when jokers are enabled', () => {
    expect(teamNameLongHint(0)).toBe('Name ist zu lang – wird im Punkte-Header auf kleineren Bildschirmen abgekürzt.');
    expect(teamNameLongHint(1)).toContain('(mit 1 Joker weniger Platz)');
    expect(teamNameLongHint(3)).toContain('(mit 3 Jokern weniger Platz)');
  });
});

describe('isTeamNameLong', () => {
  // The real check measures an off-screen header replica; jsdom has no layout
  // (clientWidth 0), so it always returns false here. We assert the safe
  // behaviour: never warns for blank input, and never throws / warns without
  // layout. The truncation behaviour itself is verified in the browser.
  it('is false for undefined / blank / whitespace names', () => {
    expect(isTeamNameLong(undefined, { jokerCount: 3 })).toBe(false);
    expect(isTeamNameLong('', { jokerCount: 3 })).toBe(false);
    expect(isTeamNameLong('   ', { jokerCount: 3 })).toBe(false);
  });

  it('does not warn (and does not throw) without layout', () => {
    expect(isTeamNameLong('A very long team name indeed', { jokerCount: 3 })).toBe(false);
    expect(isTeamNameLong('w'.repeat(40), { jokerCount: 0, teamCount: 4, totalGames: 5, theme: 'pub-quiz' })).toBe(false);
  });

  // Below two teams the header prints no name at all (`hasNamedTeams`), so there
  // is nothing that could truncate — whatever the name's length.
  it('is false below two teams', () => {
    expect(isTeamNameLong('w'.repeat(60), { jokerCount: 0, teamCount: 0 })).toBe(false);
    expect(isTeamNameLong('w'.repeat(60), { jokerCount: 3, teamCount: 1 })).toBe(false);
  });

  it('leaves nothing behind in the document', () => {
    isTeamNameLong('w'.repeat(40), { jokerCount: 2, teamCount: 4 });
    expect(document.querySelector('.team-name-replica')).toBeNull();
  });
});

/**
 * The replica `isTeamNameLong` measures against must be the SAME tree the real
 * `<Header>` renders, or the real CSS lays the two out differently and the hint
 * lies about where the name truncates — which is exactly how it drifted once:
 * the replica had no `.team-header-stack` columns at 3-4 teams. jsdom cannot
 * measure, but it can compare structure: tag, classes, `data-team`, ids and the
 * two custom properties the stylesheet keys off (`--joker-count` on the cell,
 * `--joker-cols` on the grid). Joker buttons are leaves — their inner icon is
 * decoration the layout does not size by.
 */
describe('header replica fidelity', () => {
  interface Node {
    tag: string;
    classes: string[];
    team: string | null;
    id: string | null;
    teamCount: string | null;
    jokerCount: string;
    jokerCols: string;
    children: Node[];
  }

  function signature(el: Element): Node {
    const style = (el as HTMLElement).style;
    return {
      tag: el.tagName.toLowerCase(),
      classes: Array.from(el.classList).sort(),
      team: el.getAttribute('data-team'),
      id: el.id || null,
      teamCount: el.getAttribute('data-team-count'),
      jokerCount: style.getPropertyValue('--joker-count'),
      jokerCols: style.getPropertyValue('--joker-cols'),
      children: el.classList.contains('header-joker') ? [] : Array.from(el.children).map(signature),
    };
  }

  // Real catalog ids (src/data/jokers.ts), none of them `comeback` so no button
  // is rendered locked.
  const JOKERS = ['call-friend', 'player-out', 'solo-answer'];

  beforeEach(() => {
    localStorage.clear();
    // An active game, so the centre slot renders the counter like the replica.
    localStorage.setItem('currentGame', JSON.stringify({ currentIndex: 0, totalGames: 3 }));
  });

  afterEach(() => {
    cleanup();
    document.querySelectorAll('.team-name-replica').forEach(el => el.remove());
  });

  async function renderRealHeader(teamCount: number, jokers: string[]) {
    fetchSettings.mockResolvedValue({
      pointSystemEnabled: true,
      teamCount,
      teamRandomizationEnabled: true,
      globalRules: [],
      enabledJokers: jokers,
      jokersInLastGame: true,
    });
    const { container } = render(
      <ThemeProvider><GameProvider><Header /></GameProvider></ThemeProvider>,
    );
    await waitFor(() => expect(container.querySelectorAll('.team-header-cell')).toHaveLength(teamCount));
    if (jokers.length > 0) {
      await waitFor(() => expect(container.querySelectorAll('.header-joker')).toHaveLength(teamCount * jokers.length));
    }
    return container.querySelector('header')!;
  }

  for (const teamCount of [2, 3, 4]) {
    for (const jokers of [[], JOKERS]) {
      it(`matches the real header at ${teamCount} teams with ${jokers.length} jokers`, async () => {
        const real = await renderRealHeader(teamCount, jokers);
        const replica = buildHeaderReplica({ teamCount, jokerCount: jokers.length })!;
        expect(replica).not.toBeNull();
        expect(signature(replica)).toEqual(signature(real));
      });
    }
  }

  it('sizes the game counter for the show\'s real length, two digits when unknown', () => {
    const counter = (totalGames?: number) =>
      buildHeaderReplica({ teamCount: 4, jokerCount: 0, totalGames })!.querySelector('#gameNumber')!.textContent;
    expect(counter(5)).toBe('Spiel 5 von 5');
    expect(counter(undefined)).toBe('Spiel 12 von 12');
    expect(counter(0)).toBe('Spiel 12 von 12');
  });

  it('re-attaches the joker grids when jokers are enabled again', () => {
    buildHeaderReplica({ teamCount: 4, jokerCount: 0 });
    expect(document.querySelectorAll('.team-name-replica .header-jokers')).toHaveLength(0);
    buildHeaderReplica({ teamCount: 4, jokerCount: 2 });
    expect(document.querySelectorAll('.team-name-replica .header-jokers')).toHaveLength(4);
    expect(document.querySelectorAll('.team-name-replica .header-joker')).toHaveLength(8);
  });

  // The admin's <html> carries the ADMIN theme; the replica must measure in the
  // show's, so the wrapper pins it — and drops it again when none is given.
  it('pins the show theme on the wrapper, transparent without one', () => {
    const header = buildHeaderReplica({ teamCount: 2, jokerCount: 0, theme: 'pub-quiz' })!;
    expect(header.parentElement!.getAttribute('data-theme')).toBe('pub-quiz');
    expect(header.parentElement!.classList.contains('team-name-replica')).toBe(true);
    buildHeaderReplica({ teamCount: 2, jokerCount: 0 });
    expect(header.parentElement!.hasAttribute('data-theme')).toBe(false);
  });
});
