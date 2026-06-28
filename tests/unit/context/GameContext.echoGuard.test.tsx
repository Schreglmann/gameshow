import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { GameProvider } from '@/context/GameContext';
import { sendWs, __emitChannelForTests } from '@/services/useBackendSocket';
import type { TeamState } from '@/types/game';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
    enabledJokers: [],
  }),
}));

// Spy on sendWs while keeping useWsChannel + __emitChannelForTests real, so we
// can emit an inbound message and observe whether the provider re-broadcasts.
vi.mock('@/services/useBackendSocket', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/useBackendSocket')>();
  return { ...actual, sendWs: vi.fn() };
});

const sendWsMock = vi.mocked(sendWs);

describe('GameContext — team-state echo guard', () => {
  beforeEach(() => {
    localStorage.clear();
    sendWsMock.mockClear();
  });

  // Regression: SET_TEAM_STATE must store the inbound payload BY REFERENCE so
  // the broadcast effect's `state.teams === lastRemoteTeamsRef.current` guard
  // holds. Re-wrapping it caused an infinite team-state echo storm between tabs
  // (30s lag + awards clobbered back to 0).
  it('does NOT re-broadcast gamemaster-team-state after applying a remote update', async () => {
    render(<GameProvider>{null}</GameProvider>);
    // Let mount effects (the initial broadcast) settle, then ignore them.
    await act(async () => { await Promise.resolve(); });
    sendWsMock.mockClear();

    const remote: TeamState = {
      team1: ['A'], team2: ['B'],
      team1Points: 3, team2Points: 1,
      team1JokersUsed: [], team2JokersUsed: [],
      scoreHistory: [], doubleNextGame: null,
    };
    act(() => { __emitChannelForTests('gamemaster-team-state', remote); });
    await act(async () => { await Promise.resolve(); });

    const teamStateEmits = sendWsMock.mock.calls.filter(c => c[0] === 'gamemaster-team-state');
    expect(teamStateEmits).toHaveLength(0);
  });

  it('applies the remote points (does not reset to 0)', async () => {
    render(<GameProvider>{null}</GameProvider>);
    await act(async () => { await Promise.resolve(); });

    const remote: TeamState = {
      team1: [], team2: [],
      team1Points: 5, team2Points: 2,
      team1JokersUsed: [], team2JokersUsed: [],
      scoreHistory: [], doubleNextGame: null,
    };
    act(() => { __emitChannelForTests('gamemaster-team-state', remote); });
    await act(async () => { await Promise.resolve(); });

    // The reducer persists points to localStorage — assert they took effect.
    expect(localStorage.getItem('team1Points')).toBe('5');
    expect(localStorage.getItem('team2Points')).toBe('2');
  });
});
