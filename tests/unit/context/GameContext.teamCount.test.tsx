import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameProvider, useGameContext } from '@/context/GameContext';
import { ALL_TEAM_KEYS, teamPoints, teamRoster } from '@/utils/teams';
import type { TeamState } from '@/types/game';
import type { ReactNode } from 'react';

const fetchSettings = vi.fn();
vi.mock('@/services/api', () => ({ fetchSettings: (...a: unknown[]) => fetchSettings(...a) }));

const sendWs = vi.fn(() => true);
// One handler per channel — GameProvider subscribes to several, so a single
// shared slot would silently keep only the last subscription.
const handlers = new Map<string, (p: unknown) => void>();
const emit = (channel: string, payload: unknown) => handlers.get(channel)?.(payload);
vi.mock('@/services/useBackendSocket', () => ({
  sendWs: (...a: unknown[]) => sendWs(...(a as [])),
  onWsOpen: () => () => {},
  useWsChannel: (channel: string, handler: (p: unknown) => void) => {
    handlers.set(channel, handler);
  },
}));

function settings(over: Record<string, unknown> = {}) {
  return {
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
    ...over,
  };
}

function Consumer() {
  const { state, dispatch, assignTeams, awardPoints } = useGameContext();
  return (
    <div>
      <div data-testid="count">{state.settings.teamCount}</div>
      <div data-testid="pse">{String(state.settings.pointSystemEnabled)}</div>
      <div data-testid="incompatible">{JSON.stringify(state.settings.incompatibleGames)}</div>
      <div data-testid="teams">{JSON.stringify(
        ALL_TEAM_KEYS.map(k => [teamRoster(state.teams, k), teamPoints(state.teams, k)]),
      )}</div>
      <div data-testid="names">{JSON.stringify(ALL_TEAM_KEYS.map(k => state.teams[`${k}Name`] ?? null))}</div>
      <div data-testid="jokers">{JSON.stringify(ALL_TEAM_KEYS.map(k => state.teams[`${k}JokersUsed`] ?? []))}</div>
      <div data-testid="history">{JSON.stringify(state.teams.scoreHistory ?? [])}</div>
      <button data-testid="assign" onClick={() => assignTeams(['a', 'b', 'c', 'd', 'e', 'f', 'g'])} />
      <button data-testid="award3" onClick={() => awardPoints('team3', 4)} />
      <button data-testid="award4" onClick={() => awardPoints('team4', 9)} />
      <button data-testid="patch-one" onClick={() => dispatch({ type: 'SET_TEAMS', payload: { team2: ['Zoe'] } })} />
      <button data-testid="clear-name" onClick={() => dispatch({ type: 'SET_TEAM_NAMES', payload: { team3Name: '  ' } })} />
      <button data-testid="name3" onClick={() => dispatch({ type: 'SET_TEAM_NAMES', payload: { team3Name: 'Gamma' } })} />
      <button data-testid="joker3" onClick={() => dispatch({ type: 'SET_JOKER_USED', payload: { team: 'team3', jokerId: 'comeback', used: true } })} />
      <button data-testid="reset" onClick={() => dispatch({ type: 'RESET_POINTS' })} />
      <button data-testid="clear-all" onClick={() => dispatch({ type: 'CLEAR_ALL' })} />
      <button data-testid="undo" onClick={() => dispatch({ type: 'UNDO_LAST_SCORE' })} />
    </div>
  );
}

function renderApp(ui: ReactNode = <Consumer />) {
  return render(<GameProvider>{ui}</GameProvider>);
}

beforeEach(() => {
  localStorage.clear();
  sendWs.mockClear();
  handlers.clear();
  fetchSettings.mockResolvedValue(settings());
});

describe('teamCount from /api/settings', () => {
  it('adopts the served count and derives pointSystemEnabled from it', async () => {
    fetchSettings.mockResolvedValue(settings({ teamCount: 4 }));
    renderApp();
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('4'));
    expect(screen.getByTestId('pse').textContent).toBe('true');
  });

  it('treats teamCount 0 as "no teams" — pointSystemEnabled false', async () => {
    fetchSettings.mockResolvedValue(settings({ teamCount: 0 }));
    renderApp();
    await waitFor(() => expect(screen.getByTestId('pse').textContent).toBe('false'));
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('falls back to two teams when the server sends no teamCount (older backend)', async () => {
    fetchSettings.mockResolvedValue(settings());
    renderApp();
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));
    expect(screen.getByTestId('pse').textContent).toBe('true');
  });

  it('falls back to 0 teams when an older backend only says pointSystemEnabled: false', async () => {
    fetchSettings.mockResolvedValue(settings({ pointSystemEnabled: false }));
    renderApp();
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0'));
  });

  it('clamps a nonsense count rather than rendering phantom teams', async () => {
    fetchSettings.mockResolvedValue(settings({ teamCount: 12 }));
    renderApp();
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('4'));
  });

  it('carries the incompatible-game list through', async () => {
    fetchSettings.mockResolvedValue(settings({
      teamCount: 3,
      incompatibleGames: [{ index: 2, title: 'Einsatzquiz', type: 'bet-quiz' }],
    }));
    renderApp();
    await waitFor(() =>
      expect(screen.getByTestId('incompatible').textContent).toContain('Einsatzquiz'));
  });
});

describe('assignTeams round-robin', () => {
  const rosters = () => JSON.parse(screen.getByTestId('teams').textContent!)
    .map((e: [string[], number]) => e[0].length);

  it('alternates between two teams, exactly as before', async () => {
    fetchSettings.mockResolvedValue(settings({ teamCount: 2 }));
    const user = userEvent.setup();
    renderApp();
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));
    await user.click(screen.getByTestId('assign'));
    expect(rosters()).toEqual([4, 3, 0, 0]); // 7 players
  });

  it('deals round-robin across three teams', async () => {
    fetchSettings.mockResolvedValue(settings({ teamCount: 3 }));
    const user = userEvent.setup();
    renderApp();
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('3'));
    await user.click(screen.getByTestId('assign'));
    expect(rosters()).toEqual([3, 2, 2, 0]);
  });

  it('deals round-robin across four teams', async () => {
    fetchSettings.mockResolvedValue(settings({ teamCount: 4 }));
    const user = userEvent.setup();
    renderApp();
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('4'));
    await user.click(screen.getByTestId('assign'));
    expect(rosters()).toEqual([2, 2, 2, 1]);
  });

  it('puts everyone on the single team when the show runs solo', async () => {
    fetchSettings.mockResolvedValue(settings({ teamCount: 1 }));
    const user = userEvent.setup();
    renderApp();
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
    await user.click(screen.getByTestId('assign'));
    expect(rosters()).toEqual([7, 0, 0, 0]);
  });

  it('deals nobody at 0 teams instead of throwing', async () => {
    fetchSettings.mockResolvedValue(settings({ teamCount: 0 }));
    const user = userEvent.setup();
    renderApp();
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0'));
    await user.click(screen.getByTestId('assign'));
    expect(rosters()).toEqual([0, 0, 0, 0]);
  });
});

describe('awarding and persisting teams 3 and 4', () => {
  it('books points for team3/team4 and persists them', async () => {
    fetchSettings.mockResolvedValue(settings({ teamCount: 4 }));
    const user = userEvent.setup();
    renderApp();
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('4'));
    await user.click(screen.getByTestId('award3'));
    await user.click(screen.getByTestId('award4'));
    const pts = JSON.parse(screen.getByTestId('teams').textContent!).map((e: [string[], number]) => e[1]);
    expect(pts).toEqual([0, 0, 4, 9]);
    expect(localStorage.getItem('team3Points')).toBe('4');
    expect(localStorage.getItem('team4Points')).toBe('9');
  });

  it('logs a team3 award to the score history so it can be undone', async () => {
    fetchSettings.mockResolvedValue(settings({ teamCount: 3 }));
    const user = userEvent.setup();
    renderApp();
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('3'));
    await user.click(screen.getByTestId('award3'));
    const log = JSON.parse(screen.getByTestId('history').textContent!);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ team: 'team3', delta: 4, pointsAfter: 4 });
    await user.click(screen.getByTestId('undo'));
    expect(JSON.parse(screen.getByTestId('teams').textContent!)[2][1]).toBe(0);
  });

  it('restores teams 3 and 4 from localStorage on a reload', async () => {
    localStorage.setItem('team3', JSON.stringify(['Ida', 'Jon']));
    localStorage.setItem('team3Points', '6');
    localStorage.setItem('team3Name', 'Gamma');
    localStorage.setItem('team4JokersUsed', JSON.stringify(['comeback']));
    fetchSettings.mockResolvedValue(settings({ teamCount: 4 }));
    renderApp();
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('4'));
    const teams = JSON.parse(screen.getByTestId('teams').textContent!);
    expect(teams[2]).toEqual([['Ida', 'Jon'], 6]);
    expect(JSON.parse(screen.getByTestId('names').textContent!)[2]).toBe('Gamma');
    expect(JSON.parse(screen.getByTestId('jokers').textContent!)[3]).toEqual(['comeback']);
  });
});

describe('SET_TEAMS / SET_TEAM_NAMES patch semantics', () => {
  it('leaves the teams a patch omits untouched', async () => {
    localStorage.setItem('team1', JSON.stringify(['Ann']));
    localStorage.setItem('team3', JSON.stringify(['Cy']));
    fetchSettings.mockResolvedValue(settings({ teamCount: 3 }));
    const user = userEvent.setup();
    renderApp();
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('3'));
    await user.click(screen.getByTestId('patch-one'));
    const teams = JSON.parse(screen.getByTestId('teams').textContent!);
    expect(teams[0][0]).toEqual(['Ann']);   // untouched
    expect(teams[1][0]).toEqual(['Zoe']);   // patched
    expect(teams[2][0]).toEqual(['Cy']);    // untouched
  });

  it('sets and clears a team-3 name, persisting both directions', async () => {
    fetchSettings.mockResolvedValue(settings({ teamCount: 3 }));
    const user = userEvent.setup();
    renderApp();
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('3'));
    await user.click(screen.getByTestId('name3'));
    expect(localStorage.getItem('team3Name')).toBe('Gamma');
    // A blank name is a clear, not a literal "  ".
    await user.click(screen.getByTestId('clear-name'));
    expect(localStorage.getItem('team3Name')).toBeNull();
    expect(JSON.parse(screen.getByTestId('names').textContent!)[2]).toBeNull();
  });
});

describe('RESET_POINTS / CLEAR_ALL cover every team', () => {
  it('zeroes teams 3 and 4 too, and clears their storage keys', async () => {
    localStorage.setItem('team3Points', '11');
    localStorage.setItem('team4Points', '2');
    localStorage.setItem('team3Name', 'Gamma');
    localStorage.setItem('team4JokersUsed', JSON.stringify(['comeback']));
    fetchSettings.mockResolvedValue(settings({ teamCount: 4 }));
    const user = userEvent.setup();
    renderApp();
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('4'));
    await user.click(screen.getByTestId('reset'));
    expect(JSON.parse(screen.getByTestId('teams').textContent!).map((e: [string[], number]) => e[1]))
      .toEqual([0, 0, 0, 0]);
    expect(localStorage.getItem('team3Points')).toBe('0');
    expect(localStorage.getItem('team3Name')).toBeNull();
    expect(localStorage.getItem('team4JokersUsed')).toBeNull();
  });

  it('CLEAR_ALL empties every team, not just the first two', async () => {
    localStorage.setItem('team4', JSON.stringify(['Zed']));
    localStorage.setItem('team4Points', '8');
    fetchSettings.mockResolvedValue(settings({ teamCount: 4 }));
    const user = userEvent.setup();
    renderApp();
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('4'));
    await user.click(screen.getByTestId('clear-all'));
    expect(JSON.parse(screen.getByTestId('teams').textContent!))
      .toEqual([[[], 0], [[], 0], [[], 0], [[], 0]]);
  });
});

describe('WS sync of teams 3 and 4', () => {
  it('applies an inbound 4-team snapshot', async () => {
    fetchSettings.mockResolvedValue(settings({ teamCount: 4 }));
    renderApp();
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('4'));
    const remote: TeamState = {
      team1: ['A'], team2: ['B'], team3: ['C'], team4: ['D'],
      team1Points: 1, team2Points: 2, team3Points: 3, team4Points: 4,
      team1JokersUsed: [], team2JokersUsed: [], team3JokersUsed: ['comeback'], team4JokersUsed: [],
      team3Name: 'Gamma',
      rev: 50,
    };
    act(() => { emit('gamemaster-team-state-v2', remote); });
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId('teams').textContent!)[3]).toEqual([['D'], 4]));
    expect(JSON.parse(screen.getByTestId('names').textContent!)[2]).toBe('Gamma');
    expect(JSON.parse(screen.getByTestId('jokers').textContent!)[2]).toEqual(['comeback']);
  });

  it('reads a 2-team payload from an older peer as empty teams 3/4, not undefined', async () => {
    fetchSettings.mockResolvedValue(settings({ teamCount: 4 }));
    renderApp();
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('4'));
    act(() => {
      emit('gamemaster-team-state-v2', {
        team1: ['A'], team2: ['B'],
        team1Points: 1, team2Points: 2,
        team1JokersUsed: [], team2JokersUsed: [],
        rev: 50,
      });
    });
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId('teams').textContent!)[0]).toEqual([['A'], 1]));
    expect(JSON.parse(screen.getByTestId('teams').textContent!)[2]).toEqual([[], 0]);
    expect(JSON.parse(screen.getByTestId('teams').textContent!)[3]).toEqual([[], 0]);
  });

  it('broadcasts on the v2 channel, never the old name', async () => {
    fetchSettings.mockResolvedValue(settings({ teamCount: 3 }));
    const user = userEvent.setup();
    renderApp();
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('3'));
    sendWs.mockClear();
    await user.click(screen.getByTestId('award3'));
    const channels = sendWs.mock.calls.map(c => (c as unknown as [string])[0]);
    expect(channels).toContain('gamemaster-team-state-v2');
    expect(channels).not.toContain('gamemaster-team-state');
  });

  it('does not echo a snapshot it just applied (the value guard covers teams 3-4)', async () => {
    fetchSettings.mockResolvedValue(settings({ teamCount: 4 }));
    renderApp();
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('4'));
    const remote: TeamState = {
      team1: [], team2: [], team3: ['C'], team4: [],
      team1Points: 0, team2Points: 0, team3Points: 3, team4Points: 0,
      team1JokersUsed: [], team2JokersUsed: [], team3JokersUsed: [], team4JokersUsed: [],
      rev: 99,
    };
    sendWs.mockClear();
    act(() => { emit('gamemaster-team-state-v2', remote); });
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId('teams').textContent!)[2]).toEqual([['C'], 3]));
    const teamStateSends = sendWs.mock.calls
      .filter(c => (c as unknown as [string])[0] === 'gamemaster-team-state-v2');
    expect(teamStateSends).toHaveLength(0);
  });
});
