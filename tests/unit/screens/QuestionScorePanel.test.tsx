import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { ThemeProvider } from '@/context/ThemeContext';
import GamemasterView from '@/components/common/GamemasterView';

/**
 * The "Wertung pro Frage" panel as the host sees it inside GamemasterView —
 * visibility gating, the gap rows, and which rows can be corrected in place.
 * See specs/gamemaster-question-scores.md.
 */

const mockAnswer: { current: unknown } = { current: null };
const mockControls: { current: unknown } = { current: null };
vi.mock('@/hooks/useGamemasterSync', () => ({
  useGamemasterAnswer: () => mockAnswer.current,
  useGamemasterControls: () => mockControls.current,
  useSendGamemasterCommand: () => () => {},
  requestShowReemit: () => {},
}));

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
    enabledJokers: [],
  }),
  fetchTheme: vi.fn().mockResolvedValue({ frontend: 'galaxia', admin: 'galaxia' }),
  saveTheme: vi.fn().mockResolvedValue(undefined),
}));

const TALLY_KEY = 'correctAnswersByQuestion';

function renderGM() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <GameProvider>
          <GamemasterView />
        </GameProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

function panel(): Element | null {
  return document.querySelector('.gm-qscore');
}

function rowLabels(): string[] {
  return [...document.querySelectorAll('.gm-qscore-list .gm-qscore-label-text')].map(
    el => el.textContent ?? '',
  );
}

/** Expand the collapsed-by-default panel. */
async function expand(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(panel()).not.toBeNull());
  await user.click(screen.getByText('Wertung pro Frage'));
}

function answerOn(scoringQuestion: number | undefined) {
  return {
    gameTitle: 'Test Game',
    answer: 'A',
    questionNumber: scoringQuestion ?? 0,
    totalQuestions: 5,
    ...(scoringQuestion === undefined ? {} : { scoringQuestion }),
  };
}

describe('QuestionScorePanel — visibility', () => {
  beforeEach(() => {
    localStorage.clear();
    mockAnswer.current = answerOn(3);
    mockControls.current = null;
  });

  it('shows while a game is being played', async () => {
    mockControls.current = { phase: 'game', gameIndex: 0 };
    renderGM();
    await waitFor(() => expect(panel()).not.toBeNull());
  });

  it('shows on the award-points screen (the review moment)', async () => {
    mockAnswer.current = { ...answerOn(undefined), screenLabel: 'Punktevergabe' };
    mockControls.current = { phase: 'points', gameIndex: 0 };
    localStorage.setItem(TALLY_KEY, JSON.stringify({ '0': { '1': { team1: 1, team2: 0 } } }));
    renderGM();
    await waitFor(() => expect(panel()).not.toBeNull());
  });

  // On a landing screen `gameIndex` is already the NEXT game, so the panel would
  // show empty rows for a game nobody has played.
  it('hides on the title (landing) screen', async () => {
    mockControls.current = { phase: 'landing', gameIndex: 1 };
    renderGM();
    await new Promise(r => setTimeout(r, 20));
    expect(panel()).toBeNull();
  });

  it('hides on the rules screen', async () => {
    mockControls.current = { phase: 'rules', gameIndex: 0 };
    renderGM();
    await new Promise(r => setTimeout(r, 20));
    expect(panel()).toBeNull();
  });

  it('stays hidden with no active game', async () => {
    mockControls.current = null;
    renderGM();
    await new Promise(r => setTimeout(r, 20));
    expect(panel()).toBeNull();
  });

  it('stays hidden before the first question, with nothing recorded', async () => {
    mockAnswer.current = answerOn(undefined);
    mockControls.current = { phase: 'game', gameIndex: 0 };
    renderGM();
    await new Promise(r => setTimeout(r, 20));
    expect(panel()).toBeNull();
  });
});

describe('QuestionScorePanel — tally feed (normal games)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockAnswer.current = answerOn(3);
    mockControls.current = { phase: 'game', gameIndex: 0, hideCorrectTracker: false };
  });

  it('is collapsed by default and expands on click', async () => {
    const user = userEvent.setup();
    renderGM();
    await waitFor(() => expect(panel()).not.toBeNull());

    expect(panel()?.classList.contains('collapsed')).toBe(true);
    expect(document.querySelector('.gm-qscore-list')).toBeNull();

    await user.click(screen.getByText('Wertung pro Frage'));
    expect(panel()?.classList.contains('collapsed')).toBe(false);
    expect(document.querySelector('.gm-qscore-list')).not.toBeNull();
  });

  it('marks a skipped question as "keine Wertung"', async () => {
    const user = userEvent.setup();
    localStorage.setItem(TALLY_KEY, JSON.stringify({
      '0': { '1': { team1: 1, team2: 0 }, '3': { team1: 0, team2: 1 } },
    }));
    renderGM();
    await expand(user);

    expect(rowLabels()).toEqual(['Frage 1', 'Frage 2', 'Frage 3']);
    expect(screen.getAllByText('keine Wertung')).toHaveLength(1);
    const empties = document.querySelectorAll('.gm-qscore-row--empty');
    expect(empties).toHaveLength(1);
    expect(empties[0].textContent).toContain('Frage 2');
  });

  it('corrects a forgotten question in place', async () => {
    const user = userEvent.setup();
    localStorage.setItem(TALLY_KEY, JSON.stringify({ '0': { '1': { team1: 1, team2: 0 } } }));
    renderGM();
    await expand(user);

    // Frage 2 and Frage 3 both start as gaps (the live question is 3).
    expect(screen.getAllByText('keine Wertung')).toHaveLength(2);

    await user.click(screen.getByLabelText('Frage 2 Team 1 plus'));

    const stored = JSON.parse(localStorage.getItem(TALLY_KEY)!);
    expect(stored['0']['2']).toEqual({ team1: 1, team2: 0 });
    // Only Frage 2 stopped being a gap; Frage 3 is still legitimately empty.
    expect(screen.getAllByText('keine Wertung')).toHaveLength(1);
    const empty = document.querySelectorAll('.gm-qscore-row--empty');
    expect(empty).toHaveLength(1);
    expect(empty[0].textContent).toContain('Frage 3');
  });

  it('disables a row\'s − at zero', async () => {
    const user = userEvent.setup();
    localStorage.setItem(TALLY_KEY, JSON.stringify({ '0': { '1': { team1: 1, team2: 0 } } }));
    renderGM();
    await expand(user);

    expect((screen.getByLabelText('Frage 1 Team 1 minus') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByLabelText('Frage 1 Team 2 minus') as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps a later corrected row visible after navigating back', async () => {
    const user = userEvent.setup();
    localStorage.setItem(TALLY_KEY, JSON.stringify({ '0': { '4': { team1: 1, team2: 0 } } }));
    mockAnswer.current = answerOn(2); // host stepped back to question 2
    renderGM();
    await expand(user);

    expect(rowLabels()).toEqual(['Frage 1', 'Frage 2', 'Frage 3', 'Frage 4']);
  });

  it('surfaces the example and reserved buckets when they hold counts', async () => {
    const user = userEvent.setup();
    localStorage.setItem(TALLY_KEY, JSON.stringify({
      '0': { '0': { team1: 1, team2: 0 }, '1': { team1: 1, team2: 0 }, none: { team1: 0, team2: 1 } },
    }));
    mockAnswer.current = answerOn(1);
    renderGM();
    await expand(user);

    expect(rowLabels()).toEqual(['Beispiel', 'Frage 1', 'ohne Frage']);
  });
});

describe('QuestionScorePanel — score-log feed (inline-scored games)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockAnswer.current = answerOn(2);
    mockControls.current = { phase: 'game', gameIndex: 0, hideCorrectTracker: true };
  });

  function seedLog(entries: Record<string, unknown>[]) {
    localStorage.setItem('scoreHistory', JSON.stringify(entries));
  }

  it('shows net signed points per question and no edit buttons', async () => {
    const user = userEvent.setup();
    seedLog([
      { id: 'a', team: 'team1', delta: 5, pointsAfter: 5, ts: 1, gameIndex: 0, questionNumber: 1 },
      { id: 'b', team: 'team2', delta: -5, pointsAfter: 0, ts: 2, gameIndex: 0, questionNumber: 1 },
    ]);
    renderGM();
    await expand(user);

    expect(screen.getByText('+5')).toBeInTheDocument();
    expect(screen.getByText('−5')).toBeInTheDocument();
    // Read-only: corrections go through the undo in "Letzte Wertungen".
    expect(document.querySelector('.gm-qscore-btn')).toBeNull();
  });

  it('marks a cell that nets several deltas, so a double award is not hidden', async () => {
    const user = userEvent.setup();
    seedLog([
      { id: 'a', team: 'team1', delta: 10, pointsAfter: 10, ts: 1, gameIndex: 0, questionNumber: 2 },
      { id: 'b', team: 'team1', delta: -10, pointsAfter: 0, ts: 2, gameIndex: 0, questionNumber: 2 },
    ]);
    renderGM();
    await expand(user);

    expect(screen.getByText('2×')).toBeInTheDocument();
    // Netted to zero, but the row still counts as having data.
    expect(document.querySelectorAll('.gm-qscore-row--empty')).toHaveLength(1); // only Frage 1
  });

  it('puts a whole-game positional award in a Gesamt row', async () => {
    const user = userEvent.setup();
    seedLog([
      { id: 'a', team: 'team1', delta: 4, pointsAfter: 4, ts: 1, gameIndex: 0, questionNumber: 1 },
      { id: 'b', team: 'team2', delta: 6, pointsAfter: 6, ts: 2, gameIndex: 0 },
    ]);
    renderGM();
    await expand(user);

    expect(rowLabels()).toContain('Gesamt');
  });

  it('shows a dash for the team that was not awarded, not a gap', async () => {
    const user = userEvent.setup();
    seedLog([
      { id: 'a', team: 'team1', delta: 3, pointsAfter: 3, ts: 1, gameIndex: 0, questionNumber: 1 },
    ]);
    mockAnswer.current = answerOn(1);
    renderGM();
    await expand(user);

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('keine Wertung')).not.toBeInTheDocument();
  });

  it('suppresses editing while the mirrored state is desynced', async () => {
    const user = userEvent.setup();
    localStorage.setItem(TALLY_KEY, JSON.stringify({ '0': { '1': { team1: 1, team2: 0 } } }));
    // Answer card says "Startseite" while controls claim mid-game → desync banner.
    mockAnswer.current = { ...answerOn(1), screenLabel: 'Startseite' };
    mockControls.current = { phase: 'game', gameIndex: 0, hideCorrectTracker: false };
    renderGM();
    await expand(user);

    expect(document.querySelector('.gm-desync-banner')).not.toBeNull();
    expect(document.querySelector('.gm-qscore-btn')).toBeNull();
  });
});
