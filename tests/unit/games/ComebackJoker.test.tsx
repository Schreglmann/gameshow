import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameProvider, useGameContext } from '@/context/GameContext';
import BaseGameWrapper from '@/components/games/BaseGameWrapper';
import { __emitChannelForTests } from '@/services/useBackendSocket';
import type { ReactElement, ReactNode } from 'react';
import type { GamemasterCommand } from '@/types/game';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
    enabledJokers: ['comeback'],
  }),
}));

function renderWithProvider(ui: ReactNode) {
  return rtlRender(<GameProvider>{ui}</GameProvider>);
}

// ── Reducer: arm / clear / persistence ──

function ArmConsumer() {
  const { state, dispatch } = useGameContext();
  return (
    <div>
      <div data-testid="armed">{String(state.teams.doubleNextGame)}</div>
      <button data-testid="arm-t1" onClick={() => dispatch({ type: 'ARM_DOUBLE_NEXT_GAME', payload: { team: 'team1' } })}>arm1</button>
      <button data-testid="arm-t2" onClick={() => dispatch({ type: 'ARM_DOUBLE_NEXT_GAME', payload: { team: 'team2' } })}>arm2</button>
      <button data-testid="clear" onClick={() => dispatch({ type: 'CLEAR_DOUBLE_NEXT_GAME' })}>clear</button>
      <button data-testid="reset-points" onClick={() => dispatch({ type: 'RESET_POINTS' })}>reset</button>
      <button data-testid="reset-jokers" onClick={() => dispatch({ type: 'RESET_JOKERS' })}>resetjokers</button>
    </div>
  );
}

describe('Comeback-Joker — armed doubleNextGame state', () => {
  beforeEach(() => localStorage.clear());

  it('arms and clears the flag, persisting to localStorage', async () => {
    const user = userEvent.setup();
    renderWithProvider(<ArmConsumer />);
    expect(screen.getByTestId('armed').textContent).toBe('null');

    await user.click(screen.getByTestId('arm-t1'));
    expect(screen.getByTestId('armed').textContent).toBe('team1');
    expect(localStorage.getItem('doubleNextGame')).toBe('team1');

    await user.click(screen.getByTestId('clear'));
    expect(screen.getByTestId('armed').textContent).toBe('null');
    expect(localStorage.getItem('doubleNextGame')).toBeNull();
  });

  it('clears the armed flag on RESET_POINTS and RESET_JOKERS', async () => {
    const user = userEvent.setup();
    renderWithProvider(<ArmConsumer />);
    await user.click(screen.getByTestId('arm-t2'));
    expect(screen.getByTestId('armed').textContent).toBe('team2');
    await user.click(screen.getByTestId('reset-points'));
    expect(screen.getByTestId('armed').textContent).toBe('null');

    await user.click(screen.getByTestId('arm-t2'));
    await user.click(screen.getByTestId('reset-jokers'));
    expect(screen.getByTestId('armed').textContent).toBe('null');
  });

  it('restores the armed flag from localStorage on init', () => {
    localStorage.setItem('doubleNextGame', 'team1');
    renderWithProvider(<ArmConsumer />);
    expect(screen.getByTestId('armed').textContent).toBe('team1');
  });

  it('ignores a malformed persisted value', () => {
    localStorage.setItem('doubleNextGame', 'bogus');
    renderWithProvider(<ArmConsumer />);
    expect(screen.getByTestId('armed').textContent).toBe('null');
  });
});

// ── Multiplier in BaseGameWrapper.handleComplete ──

describe('Comeback-Joker — ×2 multiplier on award', () => {
  beforeEach(() => localStorage.clear());

  const baseProps = {
    title: 'Test Game',
    rules: ['R1'],
    totalQuestions: 3,
    pointSystemEnabled: true,
    pointValue: 3,
    onNextGame: vi.fn(),
    children: vi.fn(() => <div data-testid="game-content" />),
  };

  function renderWrapper(ui: ReactElement) {
    return rtlRender(ui, { wrapper: ({ children }) => <GameProvider>{children}</GameProvider> });
  }
  function emitCmd(controlId: string) {
    const cmd: GamemasterCommand = { controlId, timestamp: Date.now() + Math.random() };
    act(() => { __emitChannelForTests('gamemaster-command', cmd); });
  }
  async function advanceToGame() {
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
  }

  it('doubles the armed team’s positional points and clears the flag', async () => {
    localStorage.setItem('doubleNextGame', 'team1');
    const onAwardPoints = vi.fn();
    renderWrapper(<BaseGameWrapper {...baseProps} onAwardPoints={onAwardPoints} />);
    await advanceToGame();
    emitCmd('award-team1');
    // pointValue 3 → doubled to 6 for the armed team.
    expect(onAwardPoints).toHaveBeenCalledWith('team1', 6);
    await waitFor(() => expect(localStorage.getItem('doubleNextGame')).toBeNull());
  });

  it('does NOT double the non-armed team', async () => {
    localStorage.setItem('doubleNextGame', 'team1');
    const onAwardPoints = vi.fn();
    renderWrapper(<BaseGameWrapper {...baseProps} onAwardPoints={onAwardPoints} />);
    await advanceToGame();
    emitCmd('award-team2');
    expect(onAwardPoints).toHaveBeenCalledWith('team2', 3);
  });

  it('on a draw, only the armed team’s points double', async () => {
    localStorage.setItem('doubleNextGame', 'team2');
    const onAwardPoints = vi.fn();
    renderWrapper(<BaseGameWrapper {...baseProps} onAwardPoints={onAwardPoints} />);
    await advanceToGame();
    emitCmd('award-draw');
    expect(onAwardPoints).toHaveBeenCalledWith('team1', 3);
    expect(onAwardPoints).toHaveBeenCalledWith('team2', 6);
  });

  it('awards normally when no joker is armed', async () => {
    const onAwardPoints = vi.fn();
    renderWrapper(<BaseGameWrapper {...baseProps} onAwardPoints={onAwardPoints} />);
    await advanceToGame();
    emitCmd('award-team1');
    expect(onAwardPoints).toHaveBeenCalledWith('team1', 3);
  });

  it('clears a lingering armed flag when an inline-scored game completes (skipPointsScreen)', async () => {
    localStorage.setItem('doubleNextGame', 'team1');
    const onNextGame = vi.fn();
    const children = vi.fn(({ onGameComplete }: { onGameComplete: () => void }) => (
      <button data-testid="complete" onClick={onGameComplete}>done</button>
    ));
    renderWrapper(
      <BaseGameWrapper {...baseProps} skipPointsScreen onNextGame={onNextGame} onAwardPoints={vi.fn()} children={children} />,
    );
    await advanceToGame();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('complete'));
    await waitFor(() => expect(localStorage.getItem('doubleNextGame')).toBeNull());
  });
});
