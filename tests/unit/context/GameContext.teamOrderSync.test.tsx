import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameProvider, useGameContext } from '@/context/GameContext';
import { sendWs, __emitChannelForTests, __clearWsCacheForTests } from '@/services/useBackendSocket';
import type { TeamState } from '@/types/game';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    teamMirrorEnabled: true,
    globalRules: [],
    enabledJokers: [],
  }),
}));

// Spy on sendWs while keeping useWsChannel + __emitChannelForTests real, so we
// can emit an inbound message and observe both the applied state and whether
// the provider re-broadcasts.
vi.mock('@/services/useBackendSocket', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/useBackendSocket')>();
  return { ...actual, sendWs: vi.fn() };
});

const sendWsMock = vi.mocked(sendWs);

function Consumer() {
  const { state, dispatch } = useGameContext();
  return (
    <div>
      <div data-testid="order-swapped">{String(state.teams.orderSwapped ?? false)}</div>
      <div data-testid="team1-points">{state.teams.team1Points}</div>
      {/* The admin SessionTab payload shape: no orderSwapped, no scoreHistory. */}
      <button
        data-testid="session-save"
        onClick={() =>
          dispatch({
            type: 'SET_TEAM_STATE',
            payload: {
              team1: ['Anna'],
              team2: ['Carla'],
              team1Points: 4,
              team2Points: 2,
              team1JokersUsed: [],
              team2JokersUsed: [],
            },
          })
        }
      >
        Save session
      </button>
    </div>
  );
}

function remoteState(overrides: Partial<TeamState> = {}): TeamState {
  return {
    team1: ['Anna'],
    team2: ['Carla'],
    team1Points: 3,
    team2Points: 1,
    team1JokersUsed: [],
    team2JokersUsed: [],
    scoreHistory: [],
    doubleNextGame: null,
    ...overrides,
  };
}

// Regression: `orderSwapped` rides the `gamemaster-team-state-v2` channel. The
// inbound normalizer used to rebuild a whitelist object that dropped it, so
// only the device that pressed "Teams tauschen" knew about the swap — the GM
// surfaces that compute their own order (CorrectAnswersTracker, joker cards)
// silently stopped mirroring the show. See specs/team-order-mirror.md.
describe('GameContext — team order cross-device sync', () => {
  beforeEach(() => {
    localStorage.clear();
    sendWsMock.mockClear();
    // Late subscribers replay the client-side last-value cache, so a payload
    // emitted by an earlier test would be re-applied on the next mount.
    __clearWsCacheForTests();
  });

  it('applies orderSwapped from an inbound gamemaster-team-state-v2', async () => {
    render(<GameProvider><Consumer /></GameProvider>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('order-swapped').textContent).toBe('false');

    act(() => { __emitChannelForTests('gamemaster-team-state-v2', remoteState({ orderSwapped: true })); });

    expect(screen.getByTestId('order-swapped').textContent).toBe('true');
    expect(localStorage.getItem('teamOrderSwapped')).toBe('true');
  });

  it('clears a local swap when the inbound payload says orderSwapped: false', async () => {
    localStorage.setItem('teamOrderSwapped', 'true');
    render(<GameProvider><Consumer /></GameProvider>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('order-swapped').textContent).toBe('true');

    act(() => { __emitChannelForTests('gamemaster-team-state-v2', remoteState({ orderSwapped: false })); });

    expect(screen.getByTestId('order-swapped').textContent).toBe('false');
    expect(localStorage.getItem('teamOrderSwapped')).toBe('false');
  });

  it('treats a payload without orderSwapped as "not swapped" over the wire', async () => {
    localStorage.setItem('teamOrderSwapped', 'true');
    render(<GameProvider><Consumer /></GameProvider>);
    await act(async () => { await Promise.resolve(); });

    // An older/foreign client that never sends the field means "unswapped" —
    // the normalizer fills `false` explicitly rather than leaving it undefined.
    act(() => { __emitChannelForTests('gamemaster-team-state-v2', remoteState()); });

    expect(screen.getByTestId('order-swapped').textContent).toBe('false');
  });

  it('preserves orderSwapped when SET_TEAM_STATE omits it (admin SessionTab)', async () => {
    const user = userEvent.setup();
    localStorage.setItem('teamOrderSwapped', 'true');
    render(<GameProvider><Consumer /></GameProvider>);
    await act(async () => { await Promise.resolve(); });

    await user.click(screen.getByTestId('session-save'));

    expect(screen.getByTestId('team1-points').textContent).toBe('4');
    expect(screen.getByTestId('order-swapped').textContent).toBe('true');
    expect(localStorage.getItem('teamOrderSwapped')).toBe('true');
  });

  it('does not echo a swapped inbound payload back onto the channel', async () => {
    render(<GameProvider><Consumer /></GameProvider>);
    await act(async () => { await Promise.resolve(); });
    sendWsMock.mockClear();

    act(() => { __emitChannelForTests('gamemaster-team-state-v2', remoteState({ orderSwapped: true })); });
    await act(async () => { await Promise.resolve(); });

    const teamStateEmits = sendWsMock.mock.calls.filter(c => c[0] === 'gamemaster-team-state-v2');
    expect(teamStateEmits).toHaveLength(0);
  });
});
