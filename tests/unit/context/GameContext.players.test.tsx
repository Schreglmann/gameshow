// Player objects in the live team state: legacy strings converted (never
// dropped), no echo storms from object key order, and registry renames reaching
// the drawn players on the show tab. See specs/players.md.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { GameProvider, useGameContext } from '@/context/GameContext';
import { sendWs, __emitChannelForTests, __clearWsCacheForTests } from '@/services/useBackendSocket';
import type { TeamState } from '@/types/game';
import { player, rp, rpOf } from '../../_helpers/players';

const fetchSettings = vi.fn();
vi.mock('@/services/api', () => ({ fetchSettings: (...a: unknown[]) => fetchSettings(...a) }));

vi.mock('@/services/useBackendSocket', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/useBackendSocket')>();
  return { ...actual, sendWs: vi.fn() };
});

const sendWsMock = vi.mocked(sendWs);

const baseSettings = { pointSystemEnabled: true, teamRandomizationEnabled: true, globalRules: [], enabledJokers: [] };

let latest: TeamState | null = null;
let settingsLoaded = false;
function Probe() {
  const { state } = useGameContext();
  latest = state.teams;
  settingsLoaded = state.settingsLoaded;
  return null;
}

const renderApp = () => render(<GameProvider><Probe /></GameProvider>);
const teamStateSends = () => sendWsMock.mock.calls.filter(c => c[0] === 'gamemaster-team-state-v3');

beforeEach(() => {
  localStorage.clear();
  __clearWsCacheForTests();
  sendWsMock.mockClear();
  sendWsMock.mockReturnValue(true);
  latest = null;
  settingsLoaded = false;
  fetchSettings.mockResolvedValue(baseSettings);
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

describe('legacy rosters', () => {
  it('converts name strings from localStorage instead of dropping them', async () => {
    localStorage.setItem('team1', JSON.stringify(['Anna', 'Raphi W.']));
    localStorage.setItem('team2', JSON.stringify(['Ben', 42, '']));
    renderApp();
    await waitFor(() => expect(settingsLoaded).toBe(true));
    expect(latest!.team1).toEqual([rp('Anna'), rp('Raphi', 'W.')]);
    expect(latest!.team2).toEqual([rp('Ben')]);
  });

  it('converts a string roster from an older peer and does NOT echo it back', async () => {
    renderApp();
    await waitFor(() => expect(settingsLoaded).toBe(true));
    sendWsMock.mockClear();
    act(() => {
      __emitChannelForTests('gamemaster-team-state-v3', {
        team1: ['Anna Müller'], team2: ['Ben'],
        team1Points: 2, team2Points: 1,
        team1JokersUsed: [], team2JokersUsed: [],
        scoreHistory: [], doubleNextGame: null,
        rev: 10,
      });
    });
    await act(async () => { await Promise.resolve(); });
    expect(latest!.team1).toEqual([rp('Anna', 'Müller')]);
    expect(latest!.team2).toEqual([rp('Ben')]);
    expect(teamStateSends()).toHaveLength(0);
  });
});

describe('echo guard with player objects', () => {
  it('does not echo payloads whose roster objects differ only in key order', async () => {
    renderApp();
    await waitFor(() => expect(settingsLoaded).toBe(true));
    sendWsMock.mockClear();
    const payload = (team1: unknown[], rev: number) => ({
      team1, team2: [],
      team1Points: 0, team2Points: 0,
      team1JokersUsed: [], team2JokersUsed: [],
      scoreHistory: [], doubleNextGame: null,
      rev,
    });
    act(() => {
      __emitChannelForTests('gamemaster-team-state-v3',
        payload([{ id: 'anna-mueller', lastName: 'Müller', firstName: 'Anna' }], 20));
    });
    await act(async () => { await Promise.resolve(); });
    act(() => {
      __emitChannelForTests('gamemaster-team-state-v3',
        payload([{ firstName: 'Anna', id: 'anna-mueller', lastName: 'Müller' }], 20));
    });
    await act(async () => { await Promise.resolve(); });
    expect(latest!.team1).toEqual([rp('Anna', 'Müller', 'anna-mueller')]);
    expect(teamStateSends()).toHaveLength(0);
  });
});

describe('registry rename sync', () => {
  const seedDraw = () => {
    localStorage.setItem('team1', JSON.stringify([rpOf(player('Anna', 'Müller', 'anna-mueller')), rp('Ben')]));
    localStorage.setItem('team2', JSON.stringify([rpOf(player('Carla', 'Weber', 'carla-weber'))]));
    localStorage.setItem('teamsRevealed', 'true');
    fetchSettings.mockResolvedValue({
      ...baseSettings,
      players: [player('Anna', 'Meier', 'anna-mueller'), player('Carla', 'Weber', 'carla-weber')],
    });
  };

  it('updates a drawn registry player on the show tab', async () => {
    window.history.replaceState({}, '', '/show/');
    seedDraw();
    renderApp();
    const renamed = rpOf(player('Anna', 'Meier', 'anna-mueller'));
    await waitFor(() => expect(latest!.team1).toEqual([renamed, rp('Ben')]));
    expect(latest!.team2).toEqual([rpOf(player('Carla', 'Weber', 'carla-weber'))]);
    expect(JSON.parse(localStorage.getItem('team1')!)).toEqual([renamed, rp('Ben')]);
  });

  it('leaves the rosters alone on a non-show tab (GM / admin)', async () => {
    window.history.replaceState({}, '', '/admin/');
    seedDraw();
    renderApp();
    await waitFor(() => expect(settingsLoaded).toBe(true));
    await act(async () => { await Promise.resolve(); });
    expect(latest!.team1).toEqual([rpOf(player('Anna', 'Müller', 'anna-mueller')), rp('Ben')]);
  });
});
