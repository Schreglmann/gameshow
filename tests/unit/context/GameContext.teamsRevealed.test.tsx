// `TeamState.teamsRevealed`: the hidden random draw. See specs/team-management.md
// ("Verdeckte Auslosung").
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameProvider, useGameContext } from '@/context/GameContext';
import { ALL_TEAM_KEYS, teamRoster } from '@/utils/teams';
import type { TeamState } from '@/types/game';
import { fullName } from '@/utils/playerNames';
import { names, rp } from '../../_helpers/players';

const fetchSettings = vi.fn();
vi.mock('@/services/api', () => ({ fetchSettings: (...a: unknown[]) => fetchSettings(...a) }));

const sendWs = vi.fn(() => true);
const handlers = new Map<string, (p: unknown) => void>();
const emit = (channel: string, payload: unknown) => handlers.get(channel)?.(payload);
vi.mock('@/services/useBackendSocket', () => ({
  sendWs: (...a: unknown[]) => sendWs(...(a as [])),
  onWsOpen: () => () => {},
  useWsChannel: (channel: string, handler: (p: unknown) => void) => {
    handlers.set(channel, handler);
  },
}));

function Consumer() {
  const { state, dispatch, assignTeams, reconcileTeamDraw, revealTeams } = useGameContext();
  return (
    <div>
      <div data-testid="loaded">{String(state.settingsLoaded)}</div>
      <div data-testid="revealed">{String(state.teams.teamsRevealed)}</div>
      <div data-testid="teams">{JSON.stringify(ALL_TEAM_KEYS.map(k => teamRoster(state.teams, k).map(fullName)))}</div>
      <button data-testid="assign" onClick={() => assignTeams(names('A', 'B', 'C', 'D'))} />
      <button data-testid="reconcile" onClick={() => reconcileTeamDraw(names('A', 'B', 'C', 'D', 'E'))} />
      <button data-testid="reveal" onClick={() => revealTeams()} />
      <button data-testid="reset" onClick={() => dispatch({ type: 'RESET_POINTS' })} />
      <button data-testid="clear-all" onClick={() => dispatch({ type: 'CLEAR_ALL' })} />
      <button
        data-testid="set-state-without-flag"
        onClick={() => {
          const { teamsRevealed: _omit, ...rest } = state.teams;
          dispatch({ type: 'SET_TEAM_STATE', payload: { ...rest, team1Points: 5 } });
        }}
      />
    </div>
  );
}

const renderApp = () => render(<GameProvider><Consumer /></GameProvider>);
const revealed = () => screen.getByTestId('revealed').textContent;
const teams = () => JSON.parse(screen.getByTestId('teams').textContent!) as string[][];

beforeEach(() => {
  localStorage.clear();
  sendWs.mockClear();
  handlers.clear();
  fetchSettings.mockResolvedValue({ pointSystemEnabled: true, teamRandomizationEnabled: true, globalRules: [] });
});

async function ready() {
  renderApp();
  await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
}

describe('teamsRevealed', () => {
  it('starts hidden on a fresh device', async () => {
    await ready();
    expect(revealed()).toBe('false');
  });

  it('assignTeams draws without revealing; revealTeams reveals and persists', async () => {
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getByTestId('assign'));
    expect(teams()[0]!.length + teams()[1]!.length).toBe(4);
    expect(revealed()).toBe('false');
    await user.click(screen.getByTestId('reveal'));
    expect(revealed()).toBe('true');
    expect(localStorage.getItem('teamsRevealed')).toBe('true');
  });

  it('reconcileTeamDraw adds a new player without moving the existing ones', async () => {
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getByTestId('assign'));
    const before = teams();
    await user.click(screen.getByTestId('reconcile'));
    const after = teams();
    expect(after[0]!.slice(0, before[0]!.length)).toEqual(before[0]);
    expect(after[1]!.slice(0, before[1]!.length)).toEqual(before[1]);
    expect(after[0]!.length + after[1]!.length).toBe(5);
  });

  it('restores the stored flag on reload', async () => {
    localStorage.setItem('team1', JSON.stringify([rp('Anna', 'Müller')]));
    localStorage.setItem('team2', JSON.stringify([rp('Ben')]));
    localStorage.setItem('teamsRevealed', 'false');
    await ready();
    expect(revealed()).toBe('false');
    expect(teams()[0]).toEqual(['Anna Müller']);
  });

  it('derives the flag from the rosters for legacy state without the key', async () => {
    // A pre-update roster: a plain name string, converted on read.
    localStorage.setItem('team1', JSON.stringify(['Anna']));
    await ready();
    expect(revealed()).toBe('true');
    expect(teams()[0]).toEqual(['Anna']);
  });

  it('RESET_POINTS keeps it, CLEAR_ALL hides again', async () => {
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getByTestId('assign'));
    await user.click(screen.getByTestId('reveal'));
    await user.click(screen.getByTestId('reset'));
    expect(revealed()).toBe('true');
    await user.click(screen.getByTestId('clear-all'));
    expect(revealed()).toBe('false');
  });

  it('a SET_TEAM_STATE payload without the flag keeps the local value', async () => {
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getByTestId('reveal'));
    await user.click(screen.getByTestId('set-state-without-flag'));
    expect(revealed()).toBe('true');
  });

  it('broadcasts the flag over gamemaster-team-state-v3', async () => {
    const user = userEvent.setup();
    await ready();
    await user.click(screen.getByTestId('reveal'));
    const sent = sendWs.mock.calls
      .filter(c => (c as unknown[])[0] === 'gamemaster-team-state-v3')
      .map(c => (c as unknown[])[1] as TeamState);
    expect(sent[sent.length - 1]!.teamsRevealed).toBe(true);
  });

  it('applies an inbound flag, and derives it for a legacy payload without one', async () => {
    await ready();
    const base = {
      team1: [rp('A')], team2: [rp('B')],
      team1Points: 0, team2Points: 0,
      team1JokersUsed: [], team2JokersUsed: [],
    };
    act(() => { emit('gamemaster-team-state-v3', { ...base, teamsRevealed: false, rev: 50 }); });
    await waitFor(() => expect(teams()[0]).toEqual(['A']));
    expect(revealed()).toBe('false');
    act(() => { emit('gamemaster-team-state-v3', { ...base, rev: 60 }); });
    await waitFor(() => expect(revealed()).toBe('true'));
  });
});
