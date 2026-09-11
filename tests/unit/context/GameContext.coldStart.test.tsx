import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { GameProvider, useGameContext } from '@/context/GameContext';
import { sendWs, __emitChannelForTests, __clearWsCacheForTests } from '@/services/useBackendSocket';
import { isInactiveShowTab } from '@/services/showPresenceState';
import type { TeamState } from '@/types/game';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
    enabledJokers: [],
  }),
}));

vi.mock('@/services/useBackendSocket', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/useBackendSocket')>();
  return { ...actual, sendWs: vi.fn() };
});

// The cold-start gate only arms on a `/show` tab, and the fix keys off whether
// that tab is the ACTIVE show. Both are controlled per test.
vi.mock('@/services/showPresenceState', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/showPresenceState')>();
  return { ...actual, isInactiveShowTab: vi.fn(() => false) };
});

const sendWsMock = vi.mocked(sendWs);
const isInactiveShowTabMock = vi.mocked(isInactiveShowTab);

/** A live, mid-show snapshot the server would replay to a reconnecting client. */
const liveTeams: TeamState = {
  team1: ['Anna'], team2: ['Bert'],
  team1Name: 'Die Füchse', team2Name: 'Die Dachse',
  team1Points: 14, team2Points: 11,
  team1JokersUsed: ['comeback'], team2JokersUsed: [],
  scoreHistory: [{ id: '1-1', team: 'team1', delta: 3, pointsAfter: 14, ts: 1 }],
  doubleNextGame: null,
  orderSwapped: false,
  rev: 42,
};

function Probe({ onState }: { onState: (t: TeamState) => void }) {
  const { state } = useGameContext();
  onState(state.teams);
  return null;
}

describe('GameContext — cold-start gate', () => {
  beforeEach(() => {
    localStorage.clear();
    __clearWsCacheForTests();
    sendWsMock.mockClear();
    sendWsMock.mockReturnValue(true);
    isInactiveShowTabMock.mockReturnValue(false);
    // Cold start = a `/show` tab with no persisted team state at all.
    window.history.replaceState({}, '', '/show/');
  });

  // The bug this guards: the projector laptop dies mid-show, the operator opens
  // /show on a spare (no localStorage → cold gate armed). The server pushes the
  // real state at rev 42. The gate used to REFUSE it and author empty state at
  // rev 43 — so the moment the operator clicked "übernehmen", that empty
  // snapshot outranked 42 and wiped points, names, jokers and the score history
  // on every device.
  it('an INACTIVE spare show tab adopts the live snapshot instead of wiping it', async () => {
    isInactiveShowTabMock.mockReturnValue(true);
    let seen: TeamState | null = null;
    render(<GameProvider><Probe onState={(t) => { seen = t; }} /></GameProvider>);
    await act(async () => { await Promise.resolve(); });

    act(() => { __emitChannelForTests('gamemaster-team-state-v2', liveTeams); });
    await act(async () => { await Promise.resolve(); });

    expect(seen!.team1Points).toBe(14);
    expect(seen!.team2Points).toBe(11);
    expect(seen!.team1Name).toBe('Die Füchse');
    expect(seen!.team1JokersUsed).toEqual(['comeback']);
    expect(seen!.scoreHistory).toHaveLength(1);
  });

  it('an inactive spare show tab does not author a higher rev than the snapshot', async () => {
    isInactiveShowTabMock.mockReturnValue(true);
    let seen: TeamState | null = null;
    render(<GameProvider><Probe onState={(t) => { seen = t; }} /></GameProvider>);
    await act(async () => { await Promise.resolve(); });

    act(() => { __emitChannelForTests('gamemaster-team-state-v2', liveTeams); });
    await act(async () => { await Promise.resolve(); });

    // Adopted verbatim (remote: true), so it cannot outrank the peer and force
    // the wipe back onto everyone else.
    expect(seen!.rev).toBe(42);
  });

  // The gate still has a job: an ACTIVE show that was deliberately cleared must
  // not be repopulated by a stale server-cache replay.
  it('an ACTIVE show tab still refuses a stale snapshot carrying data', async () => {
    isInactiveShowTabMock.mockReturnValue(false);
    let seen: TeamState | null = null;
    render(<GameProvider><Probe onState={(t) => { seen = t; }} /></GameProvider>);
    await act(async () => { await Promise.resolve(); });

    act(() => { __emitChannelForTests('gamemaster-team-state-v2', liveTeams); });
    await act(async () => { await Promise.resolve(); });

    expect(seen!.team1Points).toBe(0);
    expect(seen!.team2Points).toBe(0);
  });
});

describe('GameContext — corrupt localStorage at boot', () => {
  beforeEach(() => {
    localStorage.clear();
    __clearWsCacheForTests();
    sendWsMock.mockClear();
    sendWsMock.mockReturnValue(true);
    isInactiveShowTabMock.mockReturnValue(false);
  });

  // There is no ErrorBoundary anywhere in src/, so a throw in getInitialState
  // fails the whole React tree — a white screen on all three PWAs.
  it('does not throw when the team roster is not valid JSON', async () => {
    localStorage.setItem('team1', '{not json');
    let seen: TeamState | null = null;
    expect(() => {
      render(<GameProvider><Probe onState={(t) => { seen = t; }} /></GameProvider>);
    }).not.toThrow();
    await act(async () => { await Promise.resolve(); });
    expect(seen!.team1).toEqual([]);
  });

  it('does not throw when the roster is valid JSON of the wrong shape', async () => {
    localStorage.setItem('team2', '{"a":1}');
    let seen: TeamState | null = null;
    expect(() => {
      render(<GameProvider><Probe onState={(t) => { seen = t; }} /></GameProvider>);
    }).not.toThrow();
    await act(async () => { await Promise.resolve(); });
    expect(seen!.team2).toEqual([]);
  });

  it('coerces a corrupt points value to 0 instead of NaN', async () => {
    localStorage.setItem('team1Points', 'not-a-number');
    let seen: TeamState | null = null;
    render(<GameProvider><Probe onState={(t) => { seen = t; }} /></GameProvider>);
    await act(async () => { await Promise.resolve(); });
    expect(seen!.team1Points).toBe(0);
    expect(Number.isNaN(seen!.team1Points)).toBe(false);
  });
});
