import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BaseGameWrapper from '@/components/games/BaseGameWrapper';

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
    render(<BaseGameWrapper {...defaultProps} skipPointsScreen={true} />);

    // Navigate to game
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });

    // Complete game
    await user.click(screen.getByTestId('complete-game'));

    // Should go straight to next game screen
    expect(screen.getByText('Nächstes Spiel')).toBeInTheDocument();
  });

  it('skips points screen when pointSystemEnabled is false', async () => {
    const user = userEvent.setup();
    render(
      <BaseGameWrapper {...defaultProps} pointSystemEnabled={false} />
    );

    // Navigate to game
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });

    // Complete game
    await user.click(screen.getByTestId('complete-game'));

    // Should go straight to next game
    expect(screen.getByText('Nächstes Spiel')).toBeInTheDocument();
  });

  it('calls onRulesShow when transitioning to rules', () => {
    const onRulesShow = vi.fn();
    render(<BaseGameWrapper {...defaultProps} onRulesShow={onRulesShow} />);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });

    expect(onRulesShow).toHaveBeenCalledTimes(1);
  });

  it('calls onNextShow when game completes', async () => {
    const user = userEvent.setup();
    const onNextShow = vi.fn();
    render(<BaseGameWrapper {...defaultProps} onNextShow={onNextShow} />);

    // Navigate to game
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });

    // Complete game
    await user.click(screen.getByTestId('complete-game'));
    expect(onNextShow).toHaveBeenCalledTimes(1);
  });

  it('calls onNextGame when next game button is clicked', async () => {
    const user = userEvent.setup();
    const onNextGame = vi.fn();
    render(
      <BaseGameWrapper
        {...defaultProps}
        pointSystemEnabled={false}
        onNextGame={onNextGame}
      />
    );

    // Navigate to game
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });

    // Complete game
    await user.click(screen.getByTestId('complete-game'));

    // Click next game button
    await user.click(screen.getByText('Nächstes Spiel'));
    expect(onNextGame).toHaveBeenCalledTimes(1);
  });
});
