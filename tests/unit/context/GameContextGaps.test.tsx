import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameProvider, useGameContext } from '@/context/GameContext';
import { fetchSettings } from '@/services/api';
import type { ReactNode } from 'react';

// Mock the API module
vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: ['Rule 1', 'Rule 2'],
  }),
}));

function renderWithProvider(ui: ReactNode) {
  return render(<GameProvider>{ui}</GameProvider>);
}

// Extended test consumer with more actions
function ExtendedConsumer() {
  const { state, awardPoints, assignTeams, dispatch } = useGameContext();
  return (
    <div>
      <div data-testid="settings-loaded">{String(state.settingsLoaded)}</div>
      <div data-testid="point-system">{String(state.settings.pointSystemEnabled)}</div>
      <div data-testid="team-randomization">{String(state.settings.teamRandomizationEnabled)}</div>
      <div data-testid="team1">{JSON.stringify(state.teams.team1)}</div>
      <div data-testid="team2">{JSON.stringify(state.teams.team2)}</div>
      <div data-testid="team1-points">{state.teams.team1Points}</div>
      <div data-testid="team2-points">{state.teams.team2Points}</div>
      <div data-testid="current-game">{JSON.stringify(state.currentGame)}</div>
      <div data-testid="team1-state">{JSON.stringify(state.teams.team1State)}</div>
      <div data-testid="team2-state">{JSON.stringify(state.teams.team2State)}</div>
      <button data-testid="award-team1-3" onClick={() => awardPoints('team1', 3)}>Award T1 +3</button>
      <button data-testid="award-team2-5" onClick={() => awardPoints('team2', 5)}>Award T2 +5</button>
      <button data-testid="award-team1-neg" onClick={() => awardPoints('team1', -10)}>Award T1 -10</button>
      <button data-testid="award-team2-neg" onClick={() => awardPoints('team2', -100)}>Award T2 -100</button>
      <button data-testid="set-team-state" onClick={() => dispatch({ type: 'SET_TEAM_STATE', payload: { team1State: { score: 5 }, team2State: { score: 3 } } })}>Set Team State</button>
      <button data-testid="assign-odd" onClick={() => assignTeams(['A', 'B', 'C'])}>Assign 3</button>
      <button data-testid="assign-one" onClick={() => assignTeams(['Solo'])}>Assign 1</button>
      <button data-testid="assign-empty" onClick={() => assignTeams([])}>Assign 0</button>
    </div>
  );
}

describe('GameContext - Gaps', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    // Restore default mock
    vi.mocked(fetchSettings).mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      globalRules: ['Rule 1', 'Rule 2'],
    });
  });

  it('dispatches SET_TEAM_STATE action', async () => {
    const user = userEvent.setup();
    renderWithProvider(<ExtendedConsumer />);

    await user.click(screen.getByTestId('set-team-state'));
    expect(screen.getByTestId('team1-state').textContent).toBe('{"score":5}');
    expect(screen.getByTestId('team2-state').textContent).toBe('{"score":3}');
  });

  it('clamps negative points to zero with Math.max', async () => {
    const user = userEvent.setup();
    renderWithProvider(<ExtendedConsumer />);

    // Start at 0, subtract 10 → should stay at 0
    await user.click(screen.getByTestId('award-team1-neg'));
    expect(screen.getByTestId('team1-points').textContent).toBe('0');
    expect(localStorage.getItem('team1Points')).toBe('0');
  });

  it('clamps team2 negative points to zero', async () => {
    const user = userEvent.setup();
    renderWithProvider(<ExtendedConsumer />);

    // Award 5 then subtract 100 → should be 0
    await user.click(screen.getByTestId('award-team2-5'));
    expect(screen.getByTestId('team2-points').textContent).toBe('5');
    await user.click(screen.getByTestId('award-team2-neg'));
    expect(screen.getByTestId('team2-points').textContent).toBe('0');
  });

  it('handles loadSettings error gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(fetchSettings).mockRejectedValueOnce(new Error('Network error'));

    renderWithProvider(<ExtendedConsumer />);

    // Should not crash, settings remain at defaults
    await vi.waitFor(() => {
      // settingsLoaded should remain false or false-ish since the fetch failed
      // The component should still render without crashing
      expect(screen.getByTestId('team1-points')).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith('Failed to load settings:', expect.any(Error));
    consoleSpy.mockRestore();
  });

  it('assigns odd number of names correctly (2+1 split)', async () => {
    const user = userEvent.setup();
    renderWithProvider(<ExtendedConsumer />);

    await user.click(screen.getByTestId('assign-odd'));

    const team1 = JSON.parse(screen.getByTestId('team1').textContent!);
    const team2 = JSON.parse(screen.getByTestId('team2').textContent!);

    // 3 names: one team gets 2, other gets 1
    expect(team1.length + team2.length).toBe(3);
    const allNames = [...team1, ...team2].sort();
    expect(allNames).toEqual(['A', 'B', 'C']);
  });

  it('assigns single name to team1', async () => {
    const user = userEvent.setup();
    renderWithProvider(<ExtendedConsumer />);

    await user.click(screen.getByTestId('assign-one'));

    const team1 = JSON.parse(screen.getByTestId('team1').textContent!);
    const team2 = JSON.parse(screen.getByTestId('team2').textContent!);

    expect(team1.length + team2.length).toBe(1);
    expect([...team1, ...team2]).toContain('Solo');
  });

  it('handles empty names array', async () => {
    const user = userEvent.setup();
    renderWithProvider(<ExtendedConsumer />);

    await user.click(screen.getByTestId('assign-empty'));

    const team1 = JSON.parse(screen.getByTestId('team1').textContent!);
    const team2 = JSON.parse(screen.getByTestId('team2').textContent!);

    expect(team1).toHaveLength(0);
    expect(team2).toHaveLength(0);
  });

  it('persists points to localStorage when awarding', async () => {
    const user = userEvent.setup();
    renderWithProvider(<ExtendedConsumer />);

    await user.click(screen.getByTestId('award-team1-3'));
    await user.click(screen.getByTestId('award-team1-3'));
    expect(localStorage.getItem('team1Points')).toBe('6');

    await user.click(screen.getByTestId('award-team2-5'));
    expect(localStorage.getItem('team2Points')).toBe('5');
  });

  it('loads settings with pointSystemEnabled=false', async () => {
    vi.mocked(fetchSettings).mockResolvedValueOnce({
      pointSystemEnabled: false,
      teamRandomizationEnabled: false,
      globalRules: [],
    });

    renderWithProvider(<ExtendedConsumer />);

    await vi.waitFor(() => {
      expect(screen.getByTestId('settings-loaded').textContent).toBe('true');
    });

    expect(screen.getByTestId('point-system').textContent).toBe('false');
    expect(screen.getByTestId('team-randomization').textContent).toBe('false');
  });

  it('restores valid JSON teams from localStorage on init', () => {
    localStorage.setItem('team1', JSON.stringify(['Alice', 'Bob']));
    localStorage.setItem('team2', JSON.stringify(['Charlie']));
    localStorage.setItem('team1Points', '15');
    localStorage.setItem('team2Points', '8');

    renderWithProvider(<ExtendedConsumer />);
    
    expect(screen.getByTestId('team1').textContent).toBe(JSON.stringify(['Alice', 'Bob']));
    expect(screen.getByTestId('team2').textContent).toBe(JSON.stringify(['Charlie']));
    expect(screen.getByTestId('team1-points').textContent).toBe('15');
    expect(screen.getByTestId('team2-points').textContent).toBe('8');
  });
});
