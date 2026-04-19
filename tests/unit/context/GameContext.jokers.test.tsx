import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameProvider, useGameContext } from '@/context/GameContext';
import type { ReactNode } from 'react';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
    enabledJokers: ['call-friend', 'double-answer'],
  }),
}));

function renderWithProvider(ui: ReactNode) {
  return render(<GameProvider>{ui}</GameProvider>);
}

function TestConsumer() {
  const { state, dispatch, awardPoints } = useGameContext();
  return (
    <div>
      <div data-testid="t1-jokers">{JSON.stringify(state.teams.team1JokersUsed)}</div>
      <div data-testid="t2-jokers">{JSON.stringify(state.teams.team2JokersUsed)}</div>
      <div data-testid="enabled-jokers">{JSON.stringify(state.settings.enabledJokers)}</div>
      <div data-testid="settings-loaded">{String(state.settingsLoaded)}</div>
      <button
        data-testid="use-t1-call"
        onClick={() => dispatch({ type: 'USE_JOKER', payload: { team: 'team1', jokerId: 'call-friend' } })}
      >
        t1 call
      </button>
      <button
        data-testid="use-t1-call-again"
        onClick={() => dispatch({ type: 'USE_JOKER', payload: { team: 'team1', jokerId: 'call-friend' } })}
      >
        t1 call again
      </button>
      <button
        data-testid="gm-set-t2-double-true"
        onClick={() => dispatch({ type: 'SET_JOKER_USED', payload: { team: 'team2', jokerId: 'double-answer', used: true } })}
      >
        gm t2 on
      </button>
      <button
        data-testid="gm-set-t2-double-false"
        onClick={() => dispatch({ type: 'SET_JOKER_USED', payload: { team: 'team2', jokerId: 'double-answer', used: false } })}
      >
        gm t2 off
      </button>
      <button
        data-testid="reset-jokers"
        onClick={() => dispatch({ type: 'RESET_JOKERS' })}
      >
        reset jokers
      </button>
      <button
        data-testid="reset-points"
        onClick={() => dispatch({ type: 'RESET_POINTS' })}
      >
        reset points
      </button>
      <button
        data-testid="award-points"
        onClick={() => awardPoints('team1', 1)}
      >
        award
      </button>
    </div>
  );
}

describe('GameContext — jokers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('hydrates enabledJokers from fetchSettings', async () => {
    renderWithProvider(<TestConsumer />);
    await vi.waitFor(() => {
      expect(screen.getByTestId('settings-loaded').textContent).toBe('true');
    });
    expect(screen.getByTestId('enabled-jokers').textContent).toBe(
      JSON.stringify(['call-friend', 'double-answer'])
    );
  });

  it('initializes joker arrays as empty and reads from localStorage', () => {
    localStorage.setItem('team1JokersUsed', JSON.stringify(['call-friend']));
    renderWithProvider(<TestConsumer />);
    expect(screen.getByTestId('t1-jokers').textContent).toBe('["call-friend"]');
    expect(screen.getByTestId('t2-jokers').textContent).toBe('[]');
  });

  it('USE_JOKER appends to team array and persists to localStorage', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestConsumer />);
    await user.click(screen.getByTestId('use-t1-call'));
    expect(screen.getByTestId('t1-jokers').textContent).toBe('["call-friend"]');
    expect(JSON.parse(localStorage.getItem('team1JokersUsed') || '[]')).toEqual(['call-friend']);
  });

  it('USE_JOKER is idempotent', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestConsumer />);
    await user.click(screen.getByTestId('use-t1-call'));
    await user.click(screen.getByTestId('use-t1-call-again'));
    expect(JSON.parse(screen.getByTestId('t1-jokers').textContent || '[]')).toEqual(['call-friend']);
  });

  it('SET_JOKER_USED toggles on and off', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestConsumer />);
    await user.click(screen.getByTestId('gm-set-t2-double-true'));
    expect(screen.getByTestId('t2-jokers').textContent).toBe('["double-answer"]');
    await user.click(screen.getByTestId('gm-set-t2-double-false'));
    expect(screen.getByTestId('t2-jokers').textContent).toBe('[]');
    expect(JSON.parse(localStorage.getItem('team2JokersUsed') || '[]')).toEqual([]);
  });

  it('RESET_JOKERS clears both arrays and localStorage', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestConsumer />);
    await user.click(screen.getByTestId('use-t1-call'));
    await user.click(screen.getByTestId('gm-set-t2-double-true'));
    await user.click(screen.getByTestId('reset-jokers'));
    expect(screen.getByTestId('t1-jokers').textContent).toBe('[]');
    expect(screen.getByTestId('t2-jokers').textContent).toBe('[]');
    expect(localStorage.getItem('team1JokersUsed')).toBeNull();
    expect(localStorage.getItem('team2JokersUsed')).toBeNull();
  });

  it('RESET_POINTS also clears joker state', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestConsumer />);
    await user.click(screen.getByTestId('use-t1-call'));
    await user.click(screen.getByTestId('award-points'));
    await user.click(screen.getByTestId('reset-points'));
    expect(screen.getByTestId('t1-jokers').textContent).toBe('[]');
    expect(localStorage.getItem('team1JokersUsed')).toBeNull();
  });

  it('cross-tab storage events sync joker state', async () => {
    renderWithProvider(<TestConsumer />);
    // Simulate another tab writing to localStorage
    localStorage.setItem('team1JokersUsed', JSON.stringify(['ask-ai']));
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'team1JokersUsed',
          newValue: JSON.stringify(['ask-ai']),
        })
      );
    });
    expect(screen.getByTestId('t1-jokers').textContent).toBe('["ask-ai"]');
  });
});
