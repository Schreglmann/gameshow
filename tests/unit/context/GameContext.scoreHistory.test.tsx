import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameProvider, useGameContext } from '@/context/GameContext';
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

  it('caps the log at 30 entries (oldest dropped)', async () => {
    const user = userEvent.setup();
    renderWithProvider(<ScoreConsumer />);

    for (let i = 0; i < 35; i++) {
      await user.click(screen.getByTestId('award-t1-3'));
    }
    expect(screen.getByTestId('history-len').textContent).toBe('30');
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
