import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameProvider, useGameContext } from '@/context/GameContext';
import { __emitChannelForTests, __clearWsCacheForTests } from '@/services/useBackendSocket';
import type { GlobalSettings } from '@/types/game';
import type { ReactNode } from 'react';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
    enabledJokers: ['call-friend', 'double-answer'],
  }),
}));

// Full GlobalSettings payload for SET_SETTINGS in the scope tests — lets a test
// pin `jokerUsageScope` deterministically instead of racing the async settings load.
const BASE_SETTINGS: GlobalSettings = {
  pointSystemEnabled: true,
  teamRandomizationEnabled: true,
  globalRules: [],
  enabledJokers: ['call-friend', 'double-answer', 'comeback'],
  jokerRules: [],
  jokersInLastGame: false,
  jokerUsageScope: 'per-gameshow',
  players: [],
};

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
      <div data-testid="scope">{state.settings.jokerUsageScope}</div>
      <div data-testid="double-next">{String(state.teams.doubleNextGame)}</div>
      <button
        data-testid="scope-per-game"
        onClick={() => dispatch({ type: 'SET_SETTINGS', payload: { ...BASE_SETTINGS, jokerUsageScope: 'per-game' } })}
      >
        per-game
      </button>
      <button
        data-testid="scope-per-gameshow"
        onClick={() => dispatch({ type: 'SET_SETTINGS', payload: { ...BASE_SETTINGS, jokerUsageScope: 'per-gameshow' } })}
      >
        per-gameshow
      </button>
      <button
        data-testid="game-0"
        onClick={() => dispatch({ type: 'SET_CURRENT_GAME', payload: { currentIndex: 0, totalGames: 5 } })}
      >
        game 0
      </button>
      <button
        data-testid="game-1"
        onClick={() => dispatch({ type: 'SET_CURRENT_GAME', payload: { currentIndex: 1, totalGames: 5 } })}
      >
        game 1
      </button>
      <button
        data-testid="game-1-total6"
        onClick={() => dispatch({ type: 'SET_CURRENT_GAME', payload: { currentIndex: 1, totalGames: 6 } })}
      >
        game 1 (total 6)
      </button>
      <button
        data-testid="use-t1-comeback"
        onClick={() => dispatch({ type: 'SET_JOKER_USED', payload: { team: 'team1', jokerId: 'comeback', used: true } })}
      >
        t1 comeback
      </button>
      <button
        data-testid="arm-double-t1"
        onClick={() => dispatch({ type: 'ARM_DOUBLE_NEXT_GAME', payload: { team: 'team1' } })}
      >
        arm double t1
      </button>
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
    __clearWsCacheForTests();
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

  it('cross-device WS team-state messages sync joker state', () => {
    renderWithProvider(<TestConsumer />);
    act(() => {
      __emitChannelForTests('gamemaster-team-state', {
        team1: [],
        team2: [],
        team1Points: 0,
        team2Points: 0,
        team1JokersUsed: ['ask-ai'],
        team2JokersUsed: [],
      });
    });
    expect(screen.getByTestId('t1-jokers').textContent).toBe('["ask-ai"]');
  });
});

describe('GameContext — jokerUsageScope (per-game refresh)', () => {
  beforeEach(() => {
    localStorage.clear();
    __clearWsCacheForTests();
  });

  it('per-game: advancing to a new game index clears non-comeback jokers for both teams', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestConsumer />);
    await vi.waitFor(() => expect(screen.getByTestId('settings-loaded').textContent).toBe('true'));
    await user.click(screen.getByTestId('scope-per-game'));
    await user.click(screen.getByTestId('game-0'));
    // Mark non-comeback jokers used on both teams while in game 0.
    await user.click(screen.getByTestId('use-t1-call'));      // team1 call-friend
    await user.click(screen.getByTestId('gm-set-t2-double-true')); // team2 double-answer
    expect(screen.getByTestId('t1-jokers').textContent).toBe('["call-friend"]');
    expect(screen.getByTestId('t2-jokers').textContent).toBe('["double-answer"]');
    // Advance to game 1 → non-comeback jokers refresh.
    await user.click(screen.getByTestId('game-1'));
    expect(screen.getByTestId('t1-jokers').textContent).toBe('[]');
    expect(screen.getByTestId('t2-jokers').textContent).toBe('[]');
    expect(JSON.parse(localStorage.getItem('team1JokersUsed') || '[]')).toEqual([]);
    expect(JSON.parse(localStorage.getItem('team2JokersUsed') || '[]')).toEqual([]);
  });

  it('per-game: the Aufholjoker (comeback) and the armed doubleNextGame survive a game change', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestConsumer />);
    await vi.waitFor(() => expect(screen.getByTestId('settings-loaded').textContent).toBe('true'));
    await user.click(screen.getByTestId('scope-per-game'));
    await user.click(screen.getByTestId('game-0'));
    await user.click(screen.getByTestId('use-t1-call'));     // non-comeback → should clear
    await user.click(screen.getByTestId('use-t1-comeback')); // comeback → should persist
    await user.click(screen.getByTestId('arm-double-t1'));   // doubleNextGame → should persist
    expect(JSON.parse(screen.getByTestId('t1-jokers').textContent || '[]')).toEqual(['call-friend', 'comeback']);
    await user.click(screen.getByTestId('game-1'));
    expect(JSON.parse(screen.getByTestId('t1-jokers').textContent || '[]')).toEqual(['comeback']);
    expect(screen.getByTestId('double-next').textContent).toBe('team1');
  });

  it('per-gameshow: advancing the game index does NOT clear jokers', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestConsumer />);
    await vi.waitFor(() => expect(screen.getByTestId('settings-loaded').textContent).toBe('true'));
    await user.click(screen.getByTestId('scope-per-gameshow'));
    await user.click(screen.getByTestId('game-0'));
    await user.click(screen.getByTestId('use-t1-call'));
    await user.click(screen.getByTestId('game-1'));
    expect(screen.getByTestId('t1-jokers').textContent).toBe('["call-friend"]');
  });

  it('per-game: a totalGames-only change (same index) does NOT clear jokers', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestConsumer />);
    await vi.waitFor(() => expect(screen.getByTestId('settings-loaded').textContent).toBe('true'));
    await user.click(screen.getByTestId('scope-per-game'));
    await user.click(screen.getByTestId('game-1'));       // index 1, total 5
    await user.click(screen.getByTestId('use-t1-call'));
    await user.click(screen.getByTestId('game-1-total6')); // index still 1, total 6 → no reset
    expect(screen.getByTestId('t1-jokers').textContent).toBe('["call-friend"]');
  });
});
