import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameProvider, useGameContext } from '@/context/GameContext';
import type { ReactNode } from 'react';

// Mock the API module
vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: ['Rule 1', 'Rule 2'],
  }),
}));

// Helper to render with provider
function renderWithProvider(ui: ReactNode) {
  return render(<GameProvider>{ui}</GameProvider>);
}

// Helper component that exposes context values
function TestConsumer() {
  const { state, awardPoints, assignTeams, dispatch } = useGameContext();
  return (
    <div>
      <div data-testid="settings-loaded">{String(state.settingsLoaded)}</div>
      <div data-testid="point-system">{String(state.settings.pointSystemEnabled)}</div>
      <div data-testid="team-randomization">{String(state.settings.teamRandomizationEnabled)}</div>
      <div data-testid="global-rules">{JSON.stringify(state.settings.globalRules)}</div>
      <div data-testid="team1">{JSON.stringify(state.teams.team1)}</div>
      <div data-testid="team2">{JSON.stringify(state.teams.team2)}</div>
      <div data-testid="team1-name">{state.teams.team1Name ?? ''}</div>
      <div data-testid="team2-name">{state.teams.team2Name ?? ''}</div>
      <div data-testid="team1-points">{state.teams.team1Points}</div>
      <div data-testid="team2-points">{state.teams.team2Points}</div>
      <div data-testid="order-swapped">{String(state.teams.orderSwapped ?? false)}</div>
      <div data-testid="current-game">{JSON.stringify(state.currentGame)}</div>
      <button data-testid="award-team1" onClick={() => awardPoints('team1', 3)}>
        Award Team 1
      </button>
      <button data-testid="award-team2" onClick={() => awardPoints('team2', 5)}>
        Award Team 2
      </button>
      <button
        data-testid="assign-teams"
        onClick={() => assignTeams(['Alice', 'Bob', 'Charlie', 'Dave'])}
      >
        Assign
      </button>
      <button
        data-testid="reset-points"
        onClick={() => dispatch({ type: 'RESET_POINTS' })}
      >
        Reset
      </button>
      <button
        data-testid="set-team-names"
        onClick={() => dispatch({ type: 'SET_TEAM_NAMES', payload: { team1Name: 'Die Adler', team2Name: '  Quizfüchse  ' } })}
      >
        Set Names
      </button>
      <button
        data-testid="set-blank-names"
        onClick={() => dispatch({ type: 'SET_TEAM_NAMES', payload: { team1Name: '   ', team2Name: '' } })}
      >
        Blank Names
      </button>
      <button
        data-testid="set-current-game"
        onClick={() =>
          dispatch({
            type: 'SET_CURRENT_GAME',
            payload: { currentIndex: 2, totalGames: 8 },
          })
        }
      >
        Set Game
      </button>
      <button
        data-testid="clear-current-game"
        onClick={() => dispatch({ type: 'SET_CURRENT_GAME', payload: null })}
      >
        Clear Game
      </button>
      <button
        data-testid="swap-order"
        onClick={() => dispatch({ type: 'SET_TEAM_ORDER', payload: { swapped: true } })}
      >
        Swap Order
      </button>
    </div>
  );
}

describe('GameContext', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('throws when useGameContext is used outside of GameProvider', () => {
    function BadConsumer() {
      useGameContext();
      return null;
    }
    // Suppress React error boundary console output
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<BadConsumer />)).toThrow(
      'useGameContext must be used within GameProvider'
    );
    consoleSpy.mockRestore();
  });

  it('loads settings from API on mount', async () => {
    renderWithProvider(<TestConsumer />);

    // Wait for settings to load
    await vi.waitFor(() => {
      expect(screen.getByTestId('settings-loaded').textContent).toBe('true');
    });

    expect(screen.getByTestId('point-system').textContent).toBe('true');
    expect(screen.getByTestId('team-randomization').textContent).toBe('true');
    expect(screen.getByTestId('global-rules').textContent).toBe('["Rule 1","Rule 2"]');
  });

  it('initializes with empty teams and zero points', () => {
    renderWithProvider(<TestConsumer />);
    expect(screen.getByTestId('team1').textContent).toBe('[]');
    expect(screen.getByTestId('team2').textContent).toBe('[]');
    expect(screen.getByTestId('team1-points').textContent).toBe('0');
    expect(screen.getByTestId('team2-points').textContent).toBe('0');
  });

  it('awards points to team1', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestConsumer />);

    await user.click(screen.getByTestId('award-team1'));
    expect(screen.getByTestId('team1-points').textContent).toBe('3');
    expect(localStorage.getItem('team1Points')).toBe('3');
  });

  it('awards points to team2', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestConsumer />);

    await user.click(screen.getByTestId('award-team2'));
    expect(screen.getByTestId('team2-points').textContent).toBe('5');
    expect(localStorage.getItem('team2Points')).toBe('5');
  });

  it('accumulates points across multiple awards', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestConsumer />);

    await user.click(screen.getByTestId('award-team1'));
    await user.click(screen.getByTestId('award-team1'));
    expect(screen.getByTestId('team1-points').textContent).toBe('6');
  });

  it('does not allow points to go below zero', async () => {
    renderWithProvider(<TestConsumer />);
    // Start at 0, attempting to subtract should stay at 0
    expect(screen.getByTestId('team1-points').textContent).toBe('0');
  });

  it('resets points for both teams', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestConsumer />);

    await user.click(screen.getByTestId('award-team1'));
    await user.click(screen.getByTestId('award-team2'));
    await user.click(screen.getByTestId('reset-points'));

    expect(screen.getByTestId('team1-points').textContent).toBe('0');
    expect(screen.getByTestId('team2-points').textContent).toBe('0');
    expect(localStorage.getItem('team1Points')).toBe('0');
    expect(localStorage.getItem('team2Points')).toBe('0');
  });

  it('assigns teams by splitting names alternately', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestConsumer />);

    await user.click(screen.getByTestId('assign-teams'));

    const team1 = JSON.parse(screen.getByTestId('team1').textContent!);
    const team2 = JSON.parse(screen.getByTestId('team2').textContent!);

    // Should have 2 members each (4 names, split alternately)
    expect(team1).toHaveLength(2);
    expect(team2).toHaveLength(2);

    // All names should be present
    const allNames = [...team1, ...team2].sort();
    expect(allNames).toEqual(['Alice', 'Bob', 'Charlie', 'Dave']);

    // Should persist to localStorage
    expect(JSON.parse(localStorage.getItem('team1')!)).toEqual(team1);
    expect(JSON.parse(localStorage.getItem('team2')!)).toEqual(team2);
  });

  it('sets team names, trimming whitespace and persisting to localStorage', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestConsumer />);

    await user.click(screen.getByTestId('set-team-names'));

    expect(screen.getByTestId('team1-name').textContent).toBe('Die Adler');
    expect(screen.getByTestId('team2-name').textContent).toBe('Quizfüchse');
    expect(localStorage.getItem('team1Name')).toBe('Die Adler');
    expect(localStorage.getItem('team2Name')).toBe('Quizfüchse');
  });

  it('treats blank names as unset and removes the localStorage keys', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestConsumer />);

    await user.click(screen.getByTestId('set-team-names'));
    await user.click(screen.getByTestId('set-blank-names'));

    expect(screen.getByTestId('team1-name').textContent).toBe('');
    expect(screen.getByTestId('team2-name').textContent).toBe('');
    expect(localStorage.getItem('team1Name')).toBeNull();
    expect(localStorage.getItem('team2Name')).toBeNull();
  });

  it('clears team names on points reset', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestConsumer />);

    await user.click(screen.getByTestId('set-team-names'));
    await user.click(screen.getByTestId('reset-points'));

    expect(screen.getByTestId('team1-name').textContent).toBe('');
    expect(screen.getByTestId('team2-name').textContent).toBe('');
    expect(localStorage.getItem('team1Name')).toBeNull();
    expect(localStorage.getItem('team2Name')).toBeNull();
  });

  it('restores team names from localStorage on init', () => {
    localStorage.setItem('team1Name', 'Adler');
    localStorage.setItem('team2Name', 'Füchse');

    renderWithProvider(<TestConsumer />);

    expect(screen.getByTestId('team1-name').textContent).toBe('Adler');
    expect(screen.getByTestId('team2-name').textContent).toBe('Füchse');
  });

  it('sets and clears current game', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestConsumer />);

    expect(screen.getByTestId('current-game').textContent).toBe('null');

    await user.click(screen.getByTestId('set-current-game'));
    expect(screen.getByTestId('current-game').textContent).toBe(
      '{"currentIndex":2,"totalGames":8}'
    );

    await user.click(screen.getByTestId('clear-current-game'));
    expect(screen.getByTestId('current-game').textContent).toBe('null');
  });

  it('defaults orderSwapped to false and toggles it via SET_TEAM_ORDER (persisted)', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestConsumer />);

    expect(screen.getByTestId('order-swapped').textContent).toBe('false');

    await user.click(screen.getByTestId('swap-order'));

    expect(screen.getByTestId('order-swapped').textContent).toBe('true');
    expect(localStorage.getItem('teamOrderSwapped')).toBe('true');
  });

  it('restores orderSwapped from localStorage on init', () => {
    localStorage.setItem('teamOrderSwapped', 'true');
    renderWithProvider(<TestConsumer />);
    expect(screen.getByTestId('order-swapped').textContent).toBe('true');
  });

  it('keeps orderSwapped across a points reset (seating is unchanged)', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestConsumer />);

    await user.click(screen.getByTestId('swap-order'));
    await user.click(screen.getByTestId('reset-points'));

    expect(screen.getByTestId('order-swapped').textContent).toBe('true');
  });

  it('restores teams from localStorage on init', () => {
    localStorage.setItem('team1', JSON.stringify(['Restored1']));
    localStorage.setItem('team2', JSON.stringify(['Restored2']));
    localStorage.setItem('team1Points', '10');
    localStorage.setItem('team2Points', '20');

    renderWithProvider(<TestConsumer />);

    expect(screen.getByTestId('team1').textContent).toBe('["Restored1"]');
    expect(screen.getByTestId('team2').textContent).toBe('["Restored2"]');
    expect(screen.getByTestId('team1-points').textContent).toBe('10');
    expect(screen.getByTestId('team2-points').textContent).toBe('20');
  });
});
