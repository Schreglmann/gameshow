import { describe, it, expect, vi } from 'vitest';
import { render as rtlRender, screen, act, waitFor, type RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameProvider } from '@/context/GameContext';
import BaseGameWrapper from '@/components/games/BaseGameWrapper';
import { __emitChannelForTests } from '@/services/useBackendSocket';
import * as backendSocket from '@/services/useBackendSocket';
import type { ReactElement } from 'react';
import type { GamemasterCommand } from '@/types/game';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    teamMirrorEnabled: true,
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
        setNavState: expect.any(Function),
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

  it('broadcasts the GM award buttons in mirrored order (team 2 first by default)', async () => {
    const user = userEvent.setup();
    const sendWsSpy = vi.spyOn(backendSocket, 'sendWs');
    render(<BaseGameWrapper {...defaultProps} />);

    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
    await user.click(screen.getByTestId('complete-game'));
    expect(screen.getByText('Punkte vergeben')).toBeInTheDocument();

    type Ctrl = { id: string; buttons?: { id: string }[] };
    type Payload = { controls?: Ctrl[] } | null;
    const awardGroups = sendWsSpy.mock.calls
      .filter(([ch]) => ch === 'gamemaster-controls')
      .map(([, data]) => (data as Payload)?.controls?.find(c => c.id === 'award'))
      .filter((c): c is Ctrl => Boolean(c));
    expect(awardGroups.length).toBeGreaterThan(0);
    // GM faces the crowd → mirror of the frontend order: team 2 first with no swap.
    expect(awardGroups[awardGroups.length - 1]!.buttons!.map(b => b.id))
      .toEqual(['award-team2', 'award-team1', 'award-draw']);
    sendWsSpy.mockRestore();
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

  describe('deadline timer (GM-triggered)', () => {
    async function advanceToGame() {
      act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
      act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
    }

    function emitCmd(controlId: string) {
      const cmd: GamemasterCommand = { controlId, timestamp: Date.now() + Math.random() };
      act(() => { __emitChannelForTests('gamemaster-command', cmd); });
    }

    it('exposes setStopAudioHandler, setAnswerRevealed, setGameTimer in the children render-prop', async () => {
      const childrenSpy = vi.fn(() => <div data-testid="game-content" />);
      render(<BaseGameWrapper {...defaultProps} children={childrenSpy} />);
      await advanceToGame();
      expect(childrenSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          setStopAudioHandler: expect.any(Function),
          setAnswerRevealed: expect.any(Function),
          setGameTimer: expect.any(Function),
        })
      );
    });

    it('renders the ring for a per-question timer declared via setGameTimer (GM mirror bug fix)', async () => {
      // A game declares its q.timer through setGameTimer — the wrapper renders the
      // SAME ring as a GM deadline, so both the show and (via broadcast) the GM
      // show the remaining time.
      let declare: ((seconds: number | null) => void) | null = null;
      const childrenSpy = vi.fn(({ setGameTimer }: { setGameTimer: (s: number | null) => void }) => {
        declare = setGameTimer;
        return <div data-testid="game-content" />;
      });
      render(<BaseGameWrapper {...defaultProps} children={childrenSpy} />);
      await advanceToGame();
      expect(screen.queryByText(/^\d+$/)).toBeNull();
      act(() => { declare?.(10); });
      await waitFor(() => expect(screen.getByText('10')).toBeInTheDocument());
      // Clearing it removes the ring.
      act(() => { declare?.(null); });
      await waitFor(() => expect(screen.queryByText('10')).toBeNull());
    });

    it('renders the Timer portal when a deadline-N command is received', async () => {
      render(<BaseGameWrapper {...defaultProps} />);
      await advanceToGame();
      expect(screen.queryByText(/^\d+$/)).toBeNull();
      emitCmd('deadline-10');
      await waitFor(() => expect(screen.getByText('10')).toBeInTheDocument());
    });

    it('removes the Timer entirely on timer-stop', async () => {
      render(<BaseGameWrapper {...defaultProps} />);
      await advanceToGame();
      emitCmd('deadline-30');
      await waitFor(() => expect(screen.getByText('30')).toBeInTheDocument());
      emitCmd('timer-stop');
      await waitFor(() => expect(screen.queryByText('30')).toBeNull());
    });

    it('timer-stop removes a per-question game timer too', async () => {
      let declare: ((seconds: number | null) => void) | null = null;
      const childrenSpy = vi.fn(({ setGameTimer }: { setGameTimer: (s: number | null) => void }) => {
        declare = setGameTimer;
        return <div data-testid="game-content" />;
      });
      render(<BaseGameWrapper {...defaultProps} children={childrenSpy} />);
      await advanceToGame();
      act(() => { declare?.(30); });
      await waitFor(() => expect(screen.getByText('30')).toBeInTheDocument());
      emitCmd('timer-stop');
      await waitFor(() => expect(screen.queryByText('30')).toBeNull());
    });

    it('freezes the Timer on timer-pause and continues on timer-resume', async () => {
      vi.useFakeTimers();
      try {
        render(<BaseGameWrapper {...defaultProps} />);
        act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
        act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
        emitCmd('deadline-30');
        expect(screen.getByText('30')).toBeInTheDocument();
        act(() => { vi.advanceTimersByTime(2000); });
        expect(screen.getByText('28')).toBeInTheDocument();
        emitCmd('timer-pause');
        // Advancing time while paused must NOT decrement.
        act(() => { vi.advanceTimersByTime(3000); });
        expect(screen.getByText('28')).toBeInTheDocument();
        emitCmd('timer-resume');
        act(() => { vi.advanceTimersByTime(2000); });
        expect(screen.getByText('26')).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('freezes the Timer while the pause/hold overlay is active and resumes when it lifts', async () => {
      vi.useFakeTimers();
      try {
        render(<BaseGameWrapper {...defaultProps} />);
        act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
        act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
        emitCmd('deadline-30');
        expect(screen.getByText('30')).toBeInTheDocument();
        act(() => { vi.advanceTimersByTime(2000); });
        expect(screen.getByText('28')).toBeInTheDocument();
        // Pause screen drops — countdown must freeze even though no timer-pause
        // command was sent.
        act(() => { __emitChannelForTests('show-hold', { active: true }); });
        act(() => { vi.advanceTimersByTime(3000); });
        expect(screen.getByText('28')).toBeInTheDocument();
        // Lifting the hold resumes from where it froze.
        act(() => { __emitChannelForTests('show-hold', { active: false }); });
        act(() => { vi.advanceTimersByTime(2000); });
        expect(screen.getByText('26')).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not resume a hand-paused Timer when the hold lifts', async () => {
      vi.useFakeTimers();
      try {
        render(<BaseGameWrapper {...defaultProps} />);
        act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
        act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
        emitCmd('deadline-30');
        act(() => { vi.advanceTimersByTime(2000); });
        expect(screen.getByText('28')).toBeInTheDocument();
        // GM pauses by hand first, THEN a hold comes and goes.
        emitCmd('timer-pause');
        act(() => { __emitChannelForTests('show-hold', { active: true }); });
        act(() => { __emitChannelForTests('show-hold', { active: false }); });
        act(() => { vi.advanceTimersByTime(3000); });
        // Still frozen — the hold must not have un-paused the manual pause.
        expect(screen.getByText('28')).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('restarts with new duration when a different deadline is pressed while running', async () => {
      render(<BaseGameWrapper {...defaultProps} />);
      await advanceToGame();
      emitCmd('deadline-60');
      await waitFor(() => expect(screen.getByText('60')).toBeInTheDocument());
      emitCmd('deadline-5');
      await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument());
      expect(screen.queryByText('60')).toBeNull();
    });

    it('does not render the Timer outside the game phase', async () => {
      render(<BaseGameWrapper {...defaultProps} />);
      // Still on landing — sending a deadline command must NOT spawn a Timer.
      emitCmd('deadline-10');
      expect(screen.queryByText('10')).toBeNull();
    });

    it('clears the deadline when the question number changes', async () => {
      const childrenSpy = vi.fn(({ setGamemasterData }: { setGamemasterData: (d: unknown) => void }) => {
        return (
          <div>
            <button
              data-testid="set-q1"
              onClick={() => setGamemasterData({ gameTitle: 'T', questionNumber: 1, totalQuestions: 3, answer: '' })}
            >q1</button>
            <button
              data-testid="set-q2"
              onClick={() => setGamemasterData({ gameTitle: 'T', questionNumber: 2, totalQuestions: 3, answer: '' })}
            >q2</button>
          </div>
        );
      });
      const user = userEvent.setup();
      render(<BaseGameWrapper {...defaultProps} children={childrenSpy} />);
      await advanceToGame();
      await user.click(screen.getByTestId('set-q1'));
      emitCmd('deadline-30');
      await waitFor(() => expect(screen.getByText('30')).toBeInTheDocument());
      await user.click(screen.getByTestId('set-q2'));
      await waitFor(() => expect(screen.queryByText('30')).toBeNull());
    });

    it('invokes registered stopAudioHandler and pauses currently-playing DOM media when the timer expires', async () => {
      vi.useFakeTimers();
      const stopAudioSpy = vi.fn();
      const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
      const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined as unknown as void);
      // Make every <audio>/<video> report as currently playing so the wrapper
      // pauses them on expiry. The default JSDOM `paused` getter returns true.
      const pausedSpy = vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockReturnValue(false);

      const childrenSpy = vi.fn(({ setStopAudioHandler }: { setStopAudioHandler: (fn: (() => (() => void) | void) | null) => void }) => {
        setStopAudioHandler(stopAudioSpy);
        return (
          <div>
            <audio data-testid="game-audio" />
            <video data-testid="game-video" />
          </div>
        );
      });

      try {
        render(<BaseGameWrapper {...defaultProps} children={childrenSpy} />);
        act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
        act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
        emitCmd('deadline-5');
        act(() => { vi.advanceTimersByTime(5500); });
        expect(stopAudioSpy).toHaveBeenCalledTimes(1);
        expect(pauseSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
      } finally {
        pausedSpy.mockRestore();
        playSpy.mockRestore();
        pauseSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('resumes paused DOM media when a new deadline starts after expiry', async () => {
      vi.useFakeTimers();
      const stopAudioSpy = vi.fn();
      const resumeAudioSpy = vi.fn();
      const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
      const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined as unknown as void);
      const pausedSpy = vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockReturnValue(false);

      const childrenSpy = vi.fn(({ setStopAudioHandler }: { setStopAudioHandler: (fn: (() => (() => void) | void) | null) => void }) => {
        // Return a resume callback from the registered pause handler.
        setStopAudioHandler(() => { stopAudioSpy(); return resumeAudioSpy; });
        return (
          <div>
            <audio data-testid="game-audio" />
          </div>
        );
      });

      try {
        render(<BaseGameWrapper {...defaultProps} children={childrenSpy} />);
        act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
        act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
        emitCmd('deadline-5');
        act(() => { vi.advanceTimersByTime(5500); });
        expect(stopAudioSpy).toHaveBeenCalledTimes(1);
        const playCallsAtExpiry = playSpy.mock.calls.length;
        // GM starts another deadline — wrapper must resume audio.
        emitCmd('deadline-10');
        expect(resumeAudioSpy).toHaveBeenCalledTimes(1);
        expect(playSpy.mock.calls.length).toBeGreaterThan(playCallsAtExpiry);
      } finally {
        pausedSpy.mockRestore();
        playSpy.mockRestore();
        pauseSpy.mockRestore();
        vi.useRealTimers();
      }
    });

    it('hides the expired timer after the auto-clear delay', async () => {
      vi.useFakeTimers();
      try {
        render(<BaseGameWrapper {...defaultProps} />);
        act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
        act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
        emitCmd('deadline-5');
        // Countdown finishes — "Zeit abgelaufen!" appears.
        act(() => { vi.advanceTimersByTime(5500); });
        expect(screen.getByText('Zeit abgelaufen!')).toBeInTheDocument();
        // Auto-clear fires after the configured delay (≈4s).
        act(() => { vi.advanceTimersByTime(4500); });
        expect(screen.queryByText('Zeit abgelaufen!')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('hides the timer immediately when the game signals answer-revealed', async () => {
      let revealAnswer = () => {};
      const childrenSpy = vi.fn(({ setAnswerRevealed }: { setAnswerRevealed: (revealed: boolean) => void }) => {
        revealAnswer = () => setAnswerRevealed(true);
        return <div data-testid="game-content" />;
      });
      render(<BaseGameWrapper {...defaultProps} children={childrenSpy} />);
      act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
      act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
      emitCmd('deadline-30');
      await waitFor(() => expect(screen.getByText('30')).toBeInTheDocument());
      act(() => { revealAnswer(); });
      await waitFor(() => expect(screen.queryByText('30')).toBeNull());
    });
  });
});
