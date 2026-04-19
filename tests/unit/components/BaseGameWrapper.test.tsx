import { describe, it, expect, vi } from 'vitest';
import { render as rtlRender, screen, act, type RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameProvider } from '@/context/GameContext';
import BaseGameWrapper from '@/components/games/BaseGameWrapper';
import type { ReactElement } from 'react';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
    enabledJokers: [],
  }),
}));

function render(ui: ReactElement, options?: RenderOptions) {
  return rtlRender(ui, {
    wrapper: ({ children }) => <GameProvider>{children}</GameProvider>,
    ...options,
  });
}

describe('BaseGameWrapper', () => {
  const defaultProps = {
    title: 'Test Game',
    rules: ['Rule 1', 'Rule 2'],
    totalQuestions: 5,
    pointSystemEnabled: true,
    pointValue: 3,
    onAwardPoints: vi.fn(),
    onNextGame: vi.fn(),
    children: vi.fn(({ onGameComplete }) => (
      <div>
        <div data-testid="game-content">Game Content</div>
        <button data-testid="complete-game" onClick={onGameComplete}>
          Complete
        </button>
      </div>
    )),
  };

  it('starts with landing phase showing title', () => {
    render(<BaseGameWrapper {...defaultProps} />);
    expect(screen.getByText('Test Game')).toBeInTheDocument();
  });

  it('transitions to rules phase on ArrowRight', () => {
    render(<BaseGameWrapper {...defaultProps} />);

    // Landing phase
    expect(screen.getByText('Test Game')).toBeInTheDocument();

    // Navigate to rules
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });

    expect(screen.getByText('Regeln:')).toBeInTheDocument();
    expect(screen.getByText('Rule 1')).toBeInTheDocument();
    expect(screen.getByText('Rule 2')).toBeInTheDocument();
  });

  it('shows total questions count in rules', () => {
    render(<BaseGameWrapper {...defaultProps} />);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });

    expect(screen.getByText('Es gibt insgesamt 5 Fragen.')).toBeInTheDocument();
  });

  it('does not show question count when totalQuestions is 0', () => {
    render(<BaseGameWrapper {...defaultProps} totalQuestions={0} />);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });

    expect(screen.queryByText(/Es gibt insgesamt/)).not.toBeInTheDocument();
  });

  it('transitions to game phase after rules', () => {
    render(<BaseGameWrapper {...defaultProps} />);

    // Landing -> Rules
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });
    // Rules -> Game
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });

    expect(screen.getByTestId('game-content')).toBeInTheDocument();
  });

  it('calls children render prop with control functions', () => {
    render(<BaseGameWrapper {...defaultProps} />);

    // Navigate to game phase
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });

    expect(defaultProps.children).toHaveBeenCalledWith(
      expect.objectContaining({
        onGameComplete: expect.any(Function),
        handleNav: expect.any(Function),
        handleBackNav: expect.any(Function),
        setNavHandler: expect.any(Function),
        setBackNavHandler: expect.any(Function),
      })
    );
  });

  it('transitions to points phase when game completes with points enabled', async () => {
    const user = userEvent.setup();
    render(<BaseGameWrapper {...defaultProps} />);

    // Navigate to game
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });

    // Complete game
    await user.click(screen.getByTestId('complete-game'));

    // Should show point award screen
    expect(screen.getByText('Punkte vergeben')).toBeInTheDocument();
  });

  it('skips points screen when skipPointsScreen is true', async () => {
    const user = userEvent.setup();
    const onNextGame = vi.fn();
    render(<BaseGameWrapper {...defaultProps} skipPointsScreen={true} onNextGame={onNextGame} />);

    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });

    await user.click(screen.getByTestId('complete-game'));

    // Should navigate immediately without showing an intermediate screen
    expect(onNextGame).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Punkte vergeben')).toBeNull();
  });

  it('skips points screen when pointSystemEnabled is false', async () => {
    const user = userEvent.setup();
    const onNextGame = vi.fn();
    render(<BaseGameWrapper {...defaultProps} pointSystemEnabled={false} onNextGame={onNextGame} />);

    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });

    await user.click(screen.getByTestId('complete-game'));

    // Should navigate immediately without showing an intermediate screen
    expect(onNextGame).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Punkte vergeben')).toBeNull();
  });

  it('calls onRulesShow when transitioning to rules', () => {
    const onRulesShow = vi.fn();
    render(<BaseGameWrapper {...defaultProps} onRulesShow={onRulesShow} />);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });

    expect(onRulesShow).toHaveBeenCalledTimes(1);
  });

  it('calls onNextShow when entering award-points phase (on game complete)', async () => {
    const user = userEvent.setup();
    const onNextShow = vi.fn();
    render(<BaseGameWrapper {...defaultProps} onNextShow={onNextShow} />);

    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });

    // Complete game — onNextShow fires immediately when award-points phase is entered
    await user.click(screen.getByTestId('complete-game'));
    expect(onNextShow).toHaveBeenCalledTimes(1);

    // Clicking an award button navigates away (onNextShow is NOT called again)
    await user.click(screen.getByText('Team 1'));
    expect(onNextShow).toHaveBeenCalledTimes(1);
  });

  it('calls onNextShow immediately when pointSystemEnabled is false', async () => {
    const user = userEvent.setup();
    const onNextShow = vi.fn();
    render(<BaseGameWrapper {...defaultProps} pointSystemEnabled={false} onNextShow={onNextShow} />);

    // Navigate to game
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });

    // Complete game — no points phase, onNextShow fires immediately
    await user.click(screen.getByTestId('complete-game'));
    expect(onNextShow).toHaveBeenCalledTimes(1);
  });

  it('calls onNextGame immediately when pointSystemEnabled is false', async () => {
    const user = userEvent.setup();
    const onNextGame = vi.fn();
    render(
      <BaseGameWrapper
        {...defaultProps}
        pointSystemEnabled={false}
        onNextGame={onNextGame}
      />
    );

    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });

    await user.click(screen.getByTestId('complete-game'));
    expect(onNextGame).toHaveBeenCalledTimes(1);
  });
});
