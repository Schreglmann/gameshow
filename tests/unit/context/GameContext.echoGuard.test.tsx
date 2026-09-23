import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { GameProvider } from '@/context/GameContext';
import { sendWs, __emitChannelForTests, __clearWsCacheForTests } from '@/services/useBackendSocket';
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

/** Minimal snapshot a peer would publish; spread and override per test. */
const baseTeams: TeamState = {
  team1: [], team2: [],
  team1Points: 0, team2Points: 0,
  team1JokersUsed: [], team2JokersUsed: [],
  scoreHistory: [], doubleNextGame: null,
};

describe('GameContext — team-state echo guard', () => {
  beforeEach(() => {
    localStorage.clear();
    __clearWsCacheForTests();
    sendWsMock.mockClear();
    // The broadcast effect only records a payload as sent when sendWs confirms
    // delivery; the default mock returns undefined (falsy) and would queue
    // every send as "pending" instead.
    sendWsMock.mockReturnValue(true);
  });

  // Regression: applying an inbound team-state must not produce an outbound
  // one. The guard compares `serializeTeams` of what we applied against what
  // the reducer produced; if those ever drift apart, every client re-broadcasts
  // every update it receives — the echo storm that caused 30s lag and awards
  // clobbered back to 0.
  it('does NOT re-broadcast gamemaster-team-state-v2 after applying a remote update', async () => {
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
    act(() => { __emitChannelForTests('gamemaster-team-state-v2', remote); });
    await act(async () => { await Promise.resolve(); });

    const teamStateEmits = sendWsMock.mock.calls.filter(c => c[0] === 'gamemaster-team-state-v2');
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
    act(() => { __emitChannelForTests('gamemaster-team-state-v2', remote); });
    await act(async () => { await Promise.resolve(); });

    // The reducer persists points to localStorage — assert they took effect.
    expect(localStorage.getItem('team1Points')).toBe('5');
    expect(localStorage.getItem('team2Points')).toBe('2');
  });

  // The guard must hold for a payload that exercises EVERY optional field,
  // including ones a minimal literal omits. This is the case that would break
  // first if a new TeamState field were added to the reducer but not to the
  // inbound normalizer (or vice versa).
  it('does NOT re-broadcast a fully-populated remote update', async () => {
    render(<GameProvider>{null}</GameProvider>);
    await act(async () => { await Promise.resolve(); });
    sendWsMock.mockClear();

    const remote: TeamState = {
      team1: ['A'], team2: ['B'],
      team1Name: 'Die Roten', team2Name: 'Die Blauen',
      team1Points: 8, team2Points: 6,
      team1JokersUsed: ['comeback'], team2JokersUsed: ['fifty'],
      scoreHistory: [{ id: '1-1', team: 'team1', delta: 3, pointsAfter: 8, ts: 1_700_000_000_000 }],
      doubleNextGame: 'team2',
      orderSwapped: true,
      rev: 12,
    };
    act(() => { __emitChannelForTests('gamemaster-team-state-v2', remote); });
    await act(async () => { await Promise.resolve(); });

    expect(sendWsMock.mock.calls.filter(c => c[0] === 'gamemaster-team-state-v2')).toHaveLength(0);
    // ...and it was actually applied, not silently dropped.
    expect(localStorage.getItem('team1Points')).toBe('8');
    expect(localStorage.getItem('teamOrderSwapped')).toBe('true');
    expect(localStorage.getItem('teamStateRev')).toBe('12');
  });

  // Stale-write guard: a peer that fell behind must not roll our score back.
  it('ignores a remote update whose rev is behind ours, and re-asserts ours', async () => {
    localStorage.setItem('team1Points', '20');
    localStorage.setItem('teamStateRev', '9');
    render(<GameProvider>{null}</GameProvider>);
    await act(async () => { await Promise.resolve(); });
    sendWsMock.mockClear();

    act(() => {
      __emitChannelForTests('gamemaster-team-state-v2', { ...baseTeams, team1Points: 4, rev: 3 });
    });
    await act(async () => { await Promise.resolve(); });

    expect(localStorage.getItem('team1Points')).toBe('20');
    const reasserts = sendWsMock.mock.calls.filter(c => c[0] === 'gamemaster-team-state-v2');
    expect(reasserts).toHaveLength(1);
    expect((reasserts[0][1] as TeamState).team1Points).toBe(20);
  });

  it('applies a remote update whose rev is ahead of ours', async () => {
    localStorage.setItem('team1Points', '20');
    localStorage.setItem('teamStateRev', '9');
    render(<GameProvider>{null}</GameProvider>);
    await act(async () => { await Promise.resolve(); });

    act(() => {
      __emitChannelForTests('gamemaster-team-state-v2', { ...baseTeams, team1Points: 4, rev: 10 });
    });
    await act(async () => { await Promise.resolve(); });

    expect(localStorage.getItem('team1Points')).toBe('4');
    expect(localStorage.getItem('teamStateRev')).toBe('10');
  });
});
