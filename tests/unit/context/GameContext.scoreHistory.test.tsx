import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameProvider, useGameContext, SCORE_HISTORY_CAP } from '@/context/GameContext';
import type { ScoreLogEntry } from '@/types/game';
import type { ReactNode } from 'react';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
  }),
}));

function renderWithProvider(ui: ReactNode) {
  return render(<GameProvider>{ui}</GameProvider>);
}

function ScoreConsumer() {
  const { state, awardPoints, dispatch } = useGameContext();
  const history = state.teams.scoreHistory ?? [];
  return (
    <div>
      <div data-testid="team1-points">{state.teams.team1Points}</div>
      <div data-testid="team2-points">{state.teams.team2Points}</div>
      <div data-testid="history-len">{history.length}</div>
      <div data-testid="history">{JSON.stringify(history)}</div>
      <button data-testid="award-t1-3" onClick={() => awardPoints('team1', 3)}>+3 t1</button>
      <button data-testid="award-t2-5" onClick={() => awardPoints('team2', 5)}>+5 t2</button>
      <button data-testid="award-t1-neg2" onClick={() => awardPoints('team1', -2)}>-2 t1</button>
      <button data-testid="award-t1-neg5" onClick={() => awardPoints('team1', -5)}>-5 t1</button>
      <button data-testid="award-t1-0" onClick={() => awardPoints('team1', 0)}>+0 t1</button>
      <button data-testid="undo-last" onClick={() => dispatch({ type: 'UNDO_LAST_SCORE' })}>undo last</button>
      <button
        data-testid="undo-first"
        onClick={() => history[0] && dispatch({ type: 'UNDO_SCORE_ENTRY', payload: { id: history[0].id } })}
      >
        undo first
      </button>
      <button data-testid="reset" onClick={() => dispatch({ type: 'RESET_POINTS' })}>reset</button>
      <button
        data-testid="set-game-0"
        onClick={() => dispatch({ type: 'SET_CURRENT_GAME', payload: { currentIndex: 0, totalGames: 5 } })}
      >
        game 0
      </button>
      <button
        data-testid="set-game-1"
        onClick={() => dispatch({ type: 'SET_CURRENT_GAME', payload: { currentIndex: 1, totalGames: 5 } })}
      >
        game 1
      </button>
      <button data-testid="set-q3" onClick={() => dispatch({ type: 'SET_CURRENT_QUESTION', payload: 3 })}>q3</button>
      <button data-testid="clear-q" onClick={() => dispatch({ type: 'SET_CURRENT_QUESTION', payload: null })}>q null</button>
      {/* Dispatch in a loop inside ONE handler — clicking `cap + n` times is slow
          and tells us nothing extra. */}
      <button
        data-testid="award-over-cap"
        onClick={() => {
          for (let i = 0; i < SCORE_HISTORY_CAP + 5; i++) awardPoints('team1', 1);
        }}
      >
        flood
      </button>
      <button
        data-testid="award-ten"
        onClick={() => {
          for (let i = 0; i < 10; i++) awardPoints('team1', 1);
        }}
      >
        ten
      </button>
    </div>
  );
}

function history(): ScoreLogEntry[] {
  return JSON.parse(screen.getByTestId('history').textContent!);
}

describe('GameContext scoreHistory (scoring-undo backbone)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('logs an entry on every positive award, with delta, pointsAfter and persistence', async () => {
    const user = userEvent.setup();
    renderWithProvider(<ScoreConsumer />);

    await user.click(screen.getByTestId('award-t1-3'));
    expect(screen.getByTestId('team1-points').textContent).toBe('3');
    const h = history();
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ team: 'team1', delta: 3, pointsAfter: 3 });
    expect(typeof h[0].id).toBe('string');
    expect(typeof h[0].ts).toBe('number');
    // persisted to localStorage
    expect(JSON.parse(localStorage.getItem('scoreHistory')!)).toHaveLength(1);
  });

  it('logs negative deltas (inline-scored game path, e.g. quizjagd)', async () => {
    const user = userEvent.setup();
    renderWithProvider(<ScoreConsumer />);

    await user.click(screen.getByTestId('award-t1-3')); // 0 -> 3
    await user.click(screen.getByTestId('award-t1-neg2')); // 3 -> 1
    const h = history();
    expect(h).toHaveLength(2);
    expect(h[1]).toMatchObject({ team: 'team1', delta: -2, pointsAfter: 1 });
    expect(screen.getByTestId('team1-points').textContent).toBe('1');
  });

  it('does not log a zero-delta award', async () => {
    const user = userEvent.setup();
    renderWithProvider(<ScoreConsumer />);

    await user.click(screen.getByTestId('award-t1-0'));
    expect(history()).toHaveLength(0);
  });

  it('logs the clamp-adjusted delta when an award would push below zero', async () => {
    const user = userEvent.setup();
    renderWithProvider(<ScoreConsumer />);

    await user.click(screen.getByTestId('award-t1-3')); // 0 -> 3
    await user.click(screen.getByTestId('award-t1-neg5')); // 3 -> 0, clamped (delta -3, not -5)
    expect(screen.getByTestId('team1-points').textContent).toBe('0');
    const h = history();
    expect(h[1]).toMatchObject({ delta: -3, pointsAfter: 0 });
  });

  it('UNDO_LAST_SCORE reverses the last delta, removes the entry, and is not itself logged', async () => {
    const user = userEvent.setup();
    renderWithProvider(<ScoreConsumer />);

    await user.click(screen.getByTestId('award-t1-3'));
    await user.click(screen.getByTestId('award-t2-5'));
    expect(screen.getByTestId('history-len').textContent).toBe('2');

    await user.click(screen.getByTestId('undo-last'));
    expect(screen.getByTestId('team2-points').textContent).toBe('0');
    expect(screen.getByTestId('team1-points').textContent).toBe('3');
    // entry removed, undo not re-logged
    expect(screen.getByTestId('history-len').textContent).toBe('1');
    expect(localStorage.getItem('team2Points')).toBe('0');
  });

  it('UNDO_SCORE_ENTRY reverses a specific (non-tail) entry only', async () => {
    const user = userEvent.setup();
    renderWithProvider(<ScoreConsumer />);

    await user.click(screen.getByTestId('award-t1-3')); // entry 0: team1 +3
    await user.click(screen.getByTestId('award-t2-5')); // entry 1: team2 +5

    await user.click(screen.getByTestId('undo-first')); // undo team1 +3
    expect(screen.getByTestId('team1-points').textContent).toBe('0');
    expect(screen.getByTestId('team2-points').textContent).toBe('5');
    const h = history();
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ team: 'team2', delta: 5 });
  });

  it('caps the log at SCORE_HISTORY_CAP entries (oldest dropped)', async () => {
    const user = userEvent.setup();
    renderWithProvider(<ScoreConsumer />);

    await user.click(screen.getByTestId('award-over-cap'));
    expect(screen.getByTestId('history-len').textContent).toBe(String(SCORE_HISTORY_CAP));
  });

  // A truncated breakdown the host trusts is worse than none, so the running
  // game's entries survive an overflow at the expense of older games'.
  // See specs/gamemaster-question-scores.md.
  it('evicts other games first, keeping the current game complete', async () => {
    const user = userEvent.setup();
    renderWithProvider(<ScoreConsumer />);

    await user.click(screen.getByTestId('set-game-0'));
    await user.click(screen.getByTestId('award-over-cap')); // fills the log with game 0

    await user.click(screen.getByTestId('set-game-1'));
    await user.click(screen.getByTestId('award-ten'));

    const h = history();
    expect(h).toHaveLength(SCORE_HISTORY_CAP);
    // Every game-1 entry survived; the overflow came out of game 0.
    expect(h.filter(e => e.gameIndex === 1)).toHaveLength(10);
    expect(h.filter(e => e.gameIndex === 0)).toHaveLength(SCORE_HISTORY_CAP - 10);
  });

  it('stamps the live question onto an award, and omits it when there is none', async () => {
    const user = userEvent.setup();
    renderWithProvider(<ScoreConsumer />);

    await user.click(screen.getByTestId('set-game-0'));
    await user.click(screen.getByTestId('set-q3'));
    await user.click(screen.getByTestId('award-t1-3'));

    expect(history()[0]).toMatchObject({ gameIndex: 0, questionNumber: 3, delta: 3 });

    // Whole-game (positional) awards happen on the points screen, where
    // BaseGameWrapper has cleared the question — they must carry none.
    await user.click(screen.getByTestId('clear-q'));
    await user.click(screen.getByTestId('award-t2-5'));

    const last = history()[1];
    expect(last).toMatchObject({ gameIndex: 0, delta: 5 });
    expect(last.questionNumber).toBeUndefined();
  });

  it('RESET_POINTS clears the log and its localStorage key', async () => {
    const user = userEvent.setup();
    renderWithProvider(<ScoreConsumer />);

    await user.click(screen.getByTestId('award-t1-3'));
    await user.click(screen.getByTestId('reset'));
    expect(screen.getByTestId('history-len').textContent).toBe('0');
    expect(localStorage.getItem('scoreHistory')).toBeNull();
  });

  it('restores the log from localStorage on init', () => {
    const seed: ScoreLogEntry[] = [
      { id: '1-1', team: 'team1', delta: 3, pointsAfter: 3, ts: 1 },
    ];
    localStorage.setItem('scoreHistory', JSON.stringify(seed));
    localStorage.setItem('team1Points', '3');

    renderWithProvider(<ScoreConsumer />);
    expect(screen.getByTestId('history-len').textContent).toBe('1');
    expect(history()[0]).toMatchObject({ delta: 3, pointsAfter: 3 });
  });

  it('drops malformed entries when restoring from localStorage', () => {
    localStorage.setItem('scoreHistory', JSON.stringify([{ bogus: true }, 42, null]));
    renderWithProvider(<ScoreConsumer />);
    expect(screen.getByTestId('history-len').textContent).toBe('0');
  });
});
