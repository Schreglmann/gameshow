import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import HomeScreen from '@/components/screens/HomeScreen';
import { GameProvider } from '@/context/GameContext';

const fetchSettings = vi.fn();
vi.mock('@/services/api', () => ({ fetchSettings: (...a: unknown[]) => fetchSettings(...a) }));
vi.mock('@/services/useBackendSocket', () => ({
  sendWs: () => true, onWsOpen: () => () => {}, useWsChannel: () => {},
}));
vi.mock('@/services/backendApi', () => ({
  fetchCacheStatus: () => Promise.resolve({ missing: [] }),
  warmAllCaches: vi.fn(),
  cancelWarmAllCaches: vi.fn(),
}));

function renderHome(over: Record<string, unknown> = {}) {
  fetchSettings.mockResolvedValue({
    pointSystemEnabled: true,
    teamCount: 3,
    teamRandomizationEnabled: true,
    globalRules: [],
    enabledJokers: [],
    players: [],
    ...over,
  });
  return render(
    <MemoryRouter><GameProvider><HomeScreen /></GameProvider></MemoryRouter>,
  );
}

const teamCards = () => [...document.querySelectorAll('#teams .team')].map(t => ({
  id: t.id,
  members: [...t.querySelectorAll('input')].map(i => (i as HTMLInputElement).value),
}));

beforeEach(() => localStorage.clear());

describe('team setup at 3-4 teams', () => {
  it('renders one card per active team', async () => {
    localStorage.setItem('team1', JSON.stringify(['Ann']));
    renderHome({ teamCount: 4 });
    await waitFor(() => expect(teamCards()).toHaveLength(4));
    expect(teamCards().map(c => c.id)).toEqual(['team1', 'team2', 'team3', 'team4']);
  });

  it('shows the roster of EVERY team, not just the first two', async () => {
    // Regression: the draft-resync key covered only team1/team2, so a team-3
    // roster was dropped from the drafts and the card rendered empty even though
    // the state (and localStorage) held it. See specs/team-count.md.
    localStorage.setItem('team1', JSON.stringify(['Ben', 'Eve']));
    localStorage.setItem('team2', JSON.stringify(['Cara', 'Dan']));
    localStorage.setItem('team3', JSON.stringify(['Ann']));
    localStorage.setItem('team4', JSON.stringify(['Zoe']));
    renderHome({ teamCount: 4 });
    await waitFor(() => expect(teamCards()).toHaveLength(4));
    expect(teamCards()).toEqual([
      { id: 'team1', members: ['Ben', 'Eve'] },
      { id: 'team2', members: ['Cara', 'Dan'] },
      { id: 'team3', members: ['Ann'] },
      { id: 'team4', members: ['Zoe'] },
    ]);
  });

  it('picks up a roster that arrives AFTER mount', async () => {
    // The same resync path, driven by an assignment rather than a cold read.
    const user = userEvent.setup();
    renderHome({ teamCount: 3, teamRandomizationEnabled: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Teams zuweisen' })).toBeInTheDocument());
    await user.type(screen.getByRole('textbox'), 'Ann, Ben, Cara, Dan, Eve');
    await user.click(screen.getByRole('button', { name: 'Teams zuweisen' }));
    await waitFor(() => expect(teamCards()).toHaveLength(3));
    // Five players round-robin over three teams → 2 / 2 / 1, all of them shown.
    expect(teamCards().map(c => c.members.length)).toEqual([2, 2, 1]);
  });

  it('drops the whole team UI at 0 teams', async () => {
    renderHome({ teamCount: 0, pointSystemEnabled: false });
    await waitFor(() => expect(screen.getByText('Zum Starten klicken')).toBeInTheDocument());
    expect(document.querySelector('#teams')).toBeNull();
  });

  it('drops the whole team UI at 1 team too — points, but no teams', async () => {
    // A solo show still SCORES (pointSystemEnabled stays true), but there is no
    // second team to split players between or play against: the audience plays
    // the show itself. So the assignment flow is suppressed exactly as at 0
    // teams, and the host just starts. See specs/team-count.md.
    localStorage.setItem('team1', JSON.stringify(['Ann']));
    renderHome({ teamCount: 1, pointSystemEnabled: true });
    await waitFor(() => expect(screen.getByText('Zum Starten klicken')).toBeInTheDocument());
    expect(document.querySelector('#teams')).toBeNull();
    expect(screen.queryByText('Team 1')).not.toBeInTheDocument();
  });

  it('still keeps the team UI at 2 teams', async () => {
    // The regression bar: only 0 and 1 lose the assignment flow.
    localStorage.setItem('team1', JSON.stringify(['Ann']));
    renderHome({ teamCount: 2 });
    await waitFor(() => expect(teamCards()).toHaveLength(2));
    expect(screen.queryByText('Zum Starten klicken')).not.toBeInTheDocument();
  });
});

describe('the incompatible-game warning', () => {
  it('names each game that will play without scoring', async () => {
    localStorage.setItem('team1', JSON.stringify(['Ann']));
    renderHome({
      teamCount: 3,
      incompatibleGames: [
        { index: 4, title: 'Georgs Quiz', type: 'bet-quiz' },
        { index: 5, title: 'Wer kennt mehr?', type: 'wer-kennt-mehr' },
      ],
    });
    await waitFor(() => expect(
      screen.getByText('2 Spiele passen nicht zu 3 Teams und werden ohne Wertung gespielt'),
    ).toBeInTheDocument());
    expect(screen.getByText(/Georgs Quiz/)).toBeInTheDocument();
    expect(screen.getByText('Runde 5', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('(Einsatzquiz)')).toBeInTheDocument();
  });

  it('uses the singular for one game', async () => {
    localStorage.setItem('team1', JSON.stringify(['Ann']));
    renderHome({ teamCount: 1, incompatibleGames: [{ index: 0, title: 'X', type: 'bet-quiz' }] });
    await waitFor(() => expect(
      screen.getByText('1 Spiel passt nicht zu 1 Team und wird ohne Wertung gespielt'),
    ).toBeInTheDocument());
  });

  it('renders nothing when every game fits', async () => {
    localStorage.setItem('team1', JSON.stringify(['Ann']));
    renderHome({ teamCount: 2, incompatibleGames: [] });
    await waitFor(() => expect(teamCards().length).toBeGreaterThan(0));
    expect(document.querySelector('.team-count-warning')).toBeNull();
  });

  it('does not start the show when the warning is clicked', async () => {
    // HomeScreen advances to /rules on ANY window click, so the banner must
    // stop propagation — reading it must not skip the team setup.
    const user = userEvent.setup();
    localStorage.setItem('team1', JSON.stringify(['Ann']));
    renderHome({ teamCount: 2, incompatibleGames: [{ index: 0, title: 'X', type: 'bet-quiz' }] });
    await waitFor(() => expect(document.querySelector('.team-count-warning')).not.toBeNull());
    await user.click(screen.getByText(/Runde 1/));
    expect(document.querySelector('.team-count-warning')).not.toBeNull();
  });
});
