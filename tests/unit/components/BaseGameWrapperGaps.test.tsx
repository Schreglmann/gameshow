import { describe, it, expect, vi, beforeEach } from 'vitest';
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

describe('BaseGameWrapper - Gaps', () => {
  const defaultProps = {
    title: 'Test Game',
    rules: ['Rule 1'],
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

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-bind children mock for each test
    defaultProps.children = vi.fn(({ onGameComplete }) => (
      <div>
        <div data-testid="game-content">Game Content</div>
        <button data-testid="complete-game" onClick={onGameComplete}>Complete</button>
      </div>
    ));
    defaultProps.onAwardPoints = vi.fn();
    defaultProps.onNextGame = vi.fn();
  });

  function advanceToGame() {
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
  }

  it('shows points screen when requiresPoints is true even if pointSystemEnabled is false', async () => {
    const user = userEvent.setup();
    render(
      <BaseGameWrapper
        {...defaultProps}
        pointSystemEnabled={false}
        requiresPoints={true}
      />
    );

    advanceToGame();
    await user.click(screen.getByTestId('complete-game'));

    // Should show point award screen because requiresPoints=true
    expect(screen.getByText('Punkte vergeben')).toBeInTheDocument();
  });

  it('calls onAwardPoints with pointValue when team1 wins', async () => {
    const user = userEvent.setup();
    render(<BaseGameWrapper {...defaultProps} pointValue={7} />);

    advanceToGame();
    await user.click(screen.getByTestId('complete-game'));

    // Selecting a team states what it would get; only the confirm books it.
    await user.click(screen.getByText('Team 1'));
    expect(screen.getByText('+7 Punkte')).toBeInTheDocument();
    expect(defaultProps.onAwardPoints).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Punkte vergeben & weiter' }));

    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team1', 7);
    expect(defaultProps.onNextGame).toHaveBeenCalled();
  });

  it('calls onAwardPoints with pointValue when team2 wins', async () => {
    const user = userEvent.setup();
    render(<BaseGameWrapper {...defaultProps} pointValue={5} />);

    advanceToGame();
    await user.click(screen.getByTestId('complete-game'));

    await user.click(screen.getByText('Team 2'));
    await user.click(screen.getByRole('button', { name: 'Punkte vergeben & weiter' }));

    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team2', 5);
    expect(defaultProps.onAwardPoints).toHaveBeenCalledTimes(1);
  });

  it('calls onAwardPoints for both teams when both are selected (draw)', async () => {
    const user = userEvent.setup();
    render(<BaseGameWrapper {...defaultProps} pointValue={4} />);

    advanceToGame();
    await user.click(screen.getByTestId('complete-game'));

    await user.click(screen.getByText('Team 1'));
    await user.click(screen.getByText('Team 2'));
    expect(screen.getByText('Unentschieden — beide Teams erhalten Punkte')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Punkte vergeben & weiter' }));

    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team1', 4);
    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team2', 4);
  });

  it('disables keyboard navigation during points phase', async () => {
    const user = userEvent.setup();
    render(<BaseGameWrapper {...defaultProps} />);

    advanceToGame();
    await user.click(screen.getByTestId('complete-game'));

    // Now in points phase, ArrowRight should NOT advance to next phase
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });

    // Should still show AwardPoints
    expect(screen.getByText('Punkte vergeben')).toBeInTheDocument();
    // onNextGame should NOT have been called
    expect(defaultProps.onNextGame).not.toHaveBeenCalled();
  });

  it('calls onNextGame immediately when no points phase (pointSystemEnabled false)', async () => {
    const user = userEvent.setup();
    render(<BaseGameWrapper {...defaultProps} pointSystemEnabled={false} />);

    advanceToGame();
    await user.click(screen.getByTestId('complete-game'));

    // Navigation is immediate — no intermediate screen
    expect(defaultProps.onNextGame).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Punkte vergeben')).toBeNull();
  });

  it('uses default pointValue of 1 when not specified', async () => {
    const user = userEvent.setup();
    const onAwardPoints = vi.fn();
    render(
      <BaseGameWrapper
        title="Test"
        rules={['R']}
        totalQuestions={1}
        pointSystemEnabled={true}
        onAwardPoints={onAwardPoints}
        onNextGame={vi.fn()}
      >
        {({ onGameComplete }) => (
          <button data-testid="complete" onClick={onGameComplete}>Done</button>
        )}
      </BaseGameWrapper>
    );

    advanceToGame();
    await user.click(screen.getByTestId('complete'));

    // Team 1 wins the default 1 point, stated in the singular before it is booked.
    await user.click(screen.getByText('Team 1'));
    expect(screen.getByText('+1 Punkt')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Punkte vergeben & weiter' }));

    expect(onAwardPoints).toHaveBeenCalledWith('team1', 1);
  });

  it('delegates handleBackNav to backNavHandler in game phase', () => {
    const mockBack = vi.fn();
    let setBackRef: ((fn: (() => void) | null) => void) | null = null;

    render(
      <BaseGameWrapper
        {...defaultProps}
        children={({ setBackNavHandler }) => {
          // Capture the setter without calling it during render
          setBackRef = setBackNavHandler;
          return <div data-testid="game">Game</div>;
        }}
      />
    );

    advanceToGame();

    // Now set the back handler via the captured setter (outside render)
    act(() => { setBackRef?.(mockBack); });

    // ArrowLeft should call the back handler
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); });
    expect(mockBack).toHaveBeenCalled();
  });

  it('does not delegate backNav outside game phase', () => {
    const mockBack = vi.fn();
    render(
      <BaseGameWrapper
        {...defaultProps}
        children={({ setBackNavHandler }) => {
          setBackNavHandler(mockBack);
          return <div>Game</div>;
        }}
      />
    );

    // In landing phase
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); });
    expect(mockBack).not.toHaveBeenCalled();
  });
});
