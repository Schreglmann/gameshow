import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import WerKenntMehr from '@/components/games/WerKenntMehr';
import { __emitChannelForTests } from '@/services/useBackendSocket';
import type { WerKenntMehrConfig } from '@/types/config';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: false,
    globalRules: [],
  }),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
}));

// Capture the autoscroll `align` argument so we can assert how the answer phase
// anchors (answer-leading vs. controls-leading) without needing real layout.
const autoScrollAlign = vi.fn();
vi.mock('@/hooks/useQuizAutoScroll', () => ({
  useQuizAutoScroll: (_key: unknown, align?: string) => { autoScrollAlign(align); },
}));

const defaultProps = {
  gameId: 'game-1',
  currentIndex: 0,
  totalGames: 5,
  pointSystemEnabled: true,
  onNextGame: vi.fn(),
  onAwardPoints: vi.fn(),
};

function makeConfig(overrides: Partial<WerKenntMehrConfig> = {}): WerKenntMehrConfig {
  return {
    type: 'wer-kennt-mehr',
    title: 'Test WKM',
    rules: ['Rule 1'],
    // The first describe block exercises COUNT mode, so the helper defaults to
    // 'count'. The real game-wide default (no scoringMode ⇒ 'standard') is covered
    // by its own block below via makeConfig({ scoringMode: undefined }).
    scoringMode: 'count',
    questions: [
      // Index 0 is the non-scoring Beispiel (practice) round.
      { question: 'Beispiel Q', answerList: ['x', 'y'] },
      { question: 'Hauptstädte', answerList: ['Berlin', 'Paris', 'Madrid'] },
      { question: 'Planeten', answer: 'Merkur, Venus' },
    ],
    ...overrides,
  };
}

function renderGame(config?: WerKenntMehrConfig) {
  return render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <WerKenntMehr {...defaultProps} config={config || makeConfig()} />
        </MusicProvider>
      </GameProvider>
    </MemoryRouter>
  );
}

function renderGameNoPoints(config?: WerKenntMehrConfig) {
  return render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <WerKenntMehr {...defaultProps} pointSystemEnabled={false} config={config || makeConfig()} />
        </MusicProvider>
      </GameProvider>
    </MemoryRouter>
  );
}

/** Advance landing -> rules -> game via ArrowRight (mirrors SimpleQuiz tests). */
async function advanceToGame() {
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
}

/** Click an element outside the quiz card to trigger the global nav-forward. */
async function navForward(user: ReturnType<typeof userEvent.setup>) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  await user.click(div);
  document.body.removeChild(div);
}

describe('WerKenntMehr', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).Audio = class MockAudio {
      src = '';
      volume = 1;
      paused = true;
      play = vi.fn().mockResolvedValue(undefined);
      pause = vi.fn();
      load = vi.fn();
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      constructor(src?: string) { if (src) this.src = src; }
    };
  });

  it('renders landing screen with title', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Test WKM')).toBeInTheDocument());
  });

  it('points off (standard mode): skips the winner screen and completes without awarding', async () => {
    const user = userEvent.setup();
    renderGameNoPoints(makeConfig({
      scoringMode: undefined,
      questions: [
        { question: 'Beispiel Q', answerList: ['x', 'y'] },
        { question: 'Real Q', answerList: ['a', 'b'] },
      ],
    }));
    await waitFor(() => expect(screen.getByText('Test WKM')).toBeInTheDocument());
    await advanceToGame();

    // Example round.
    await waitFor(() => expect(screen.getByText('Beispiel Q')).toBeInTheDocument());
    await navForward(user); // reveal
    await waitFor(() => expect(screen.getByText('x')).toBeInTheDocument());
    await navForward(user); // -> real question

    // Real question.
    await waitFor(() => expect(screen.getByText('Real Q')).toBeInTheDocument());
    await navForward(user); // reveal
    await waitFor(() => expect(screen.getByText('a')).toBeInTheDocument());
    await navForward(user); // past last question -> onGameComplete (no summary screen)

    await waitFor(() => expect(defaultProps.onNextGame).toHaveBeenCalled());
    expect(defaultProps.onAwardPoints).not.toHaveBeenCalled();
    // The final winner-selection reward screen must never appear.
    expect(screen.queryByText('Gewinner wählen')).not.toBeInTheDocument();
  });

  it('points off (count mode): hides the scoring panel', async () => {
    const user = userEvent.setup();
    renderGameNoPoints(makeConfig({
      scoringMode: 'count',
      questions: [
        { question: 'Beispiel Q', answerList: ['x', 'y'] },
        { question: 'Hauptstädte', answerList: ['Berlin', 'Paris'] },
      ],
    }));
    await waitFor(() => expect(screen.getByText('Test WKM')).toBeInTheDocument());
    await advanceToGame();

    await waitFor(() => expect(screen.getByText('Beispiel Q')).toBeInTheDocument());
    await navForward(user); // reveal example answers
    await waitFor(() => expect(screen.getByText('x')).toBeInTheDocument());

    // No scoring panel: no "Anzahl" count input, no "Punkte vergeben" button.
    expect(screen.queryByPlaceholderText('Anzahl')).not.toBeInTheDocument();
    expect(screen.queryByText('Punkte vergeben')).not.toBeInTheDocument();

    await navForward(user); // advances to the next question without scoring
    await waitFor(() => expect(screen.getByText('Hauptstädte')).toBeInTheDocument());
    expect(defaultProps.onAwardPoints).not.toHaveBeenCalled();
  });

  it('shows the Beispiel label and reveals the examples grid', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Test WKM')).toBeInTheDocument());
    await advanceToGame();

    await waitFor(() => expect(screen.getByText('Beispiel Frage')).toBeInTheDocument());
    expect(screen.queryByText('x')).not.toBeInTheDocument();

    await navForward(user); // reveal examples
    await waitFor(() => {
      expect(document.querySelector('.wkm-examples')).toBeInTheDocument();
      expect(screen.getByText('x')).toBeInTheDocument();
      expect(screen.getByText('y')).toBeInTheDocument();
    });
  });

  it('does NOT award points on the Beispiel round', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Test WKM')).toBeInTheDocument());
    await advanceToGame();
    await waitFor(() => expect(screen.getByText('Beispiel Frage')).toBeInTheDocument());

    await navForward(user); // reveal Beispiel examples
    await user.click(screen.getByRole('button', { name: 'Team 1' }));
    await user.click(screen.getByRole('button', { name: 'Weiter' }));

    // Advancing past the example must not award any points.
    expect(defaultProps.onAwardPoints).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('Frage 1 von 2')).toBeInTheDocument());
  });

  it('awards the entered count to the selected team on a real question', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Test WKM')).toBeInTheDocument());
    await advanceToGame();

    // Skip the Beispiel: reveal then advance to question 1.
    await navForward(user);
    await navForward(user);
    await waitFor(() => expect(screen.getByText('Frage 1 von 2')).toBeInTheDocument());

    await navForward(user); // reveal examples + scoring panel
    await waitFor(() => expect(screen.getByText('Berlin')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Team 1' }));
    await user.type(screen.getByPlaceholderText('Anzahl'), '12');
    await user.click(screen.getByRole('button', { name: 'Punkte vergeben' }));

    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team1', 12);
    // Exactly one award — guards against double-counting.
    expect(defaultProps.onAwardPoints).toHaveBeenCalledTimes(1);
  });

  it('anchors to the answer on reveal, then to the controls once the host starts scoring', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Test WKM')).toBeInTheDocument());
    await advanceToGame();
    await navForward(user); // reveal Beispiel
    await navForward(user); // advance to question 1
    await navForward(user); // reveal examples + scoring panel
    await waitFor(() => expect(screen.getByText('Berlin')).toBeInTheDocument());

    // On reveal the answer leads the viewport.
    expect(autoScrollAlign).toHaveBeenLastCalledWith('answer');

    // Selecting a team flips the anchor to the controls so the projector
    // follows the host's scoring input.
    await user.click(screen.getByRole('button', { name: 'Team 1' }));
    expect(autoScrollAlign).toHaveBeenLastCalledWith('bottom');
  });

  it('flips the anchor to the controls when the count input is focused', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Test WKM')).toBeInTheDocument());
    await advanceToGame();
    await navForward(user); // reveal Beispiel
    await navForward(user); // advance to question 1
    await navForward(user); // reveal examples + scoring panel
    await waitFor(() => expect(screen.getByText('Berlin')).toBeInTheDocument());

    expect(autoScrollAlign).toHaveBeenLastCalledWith('answer');
    await user.click(screen.getByPlaceholderText('Anzahl'));
    expect(autoScrollAlign).toHaveBeenLastCalledWith('bottom');
  });

  it('splits the points when both teams are selected (tie)', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Test WKM')).toBeInTheDocument());
    await advanceToGame();
    await navForward(user); // reveal Beispiel
    await navForward(user); // advance to question 1
    await navForward(user); // reveal question 1
    await waitFor(() => expect(screen.getByText('Berlin')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Team 1' }));
    await user.click(screen.getByRole('button', { name: 'Team 2' }));
    await user.type(screen.getByPlaceholderText('Anzahl'), '10');
    await user.click(screen.getByRole('button', { name: 'Punkte vergeben' }));

    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team1', 5);
    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team2', 5);
    // One award per team, no more.
    expect(defaultProps.onAwardPoints).toHaveBeenCalledTimes(2);
  });

  it('completes the game after the last question', async () => {
    const user = userEvent.setup();
    // One Beispiel + one real (the real one is the last).
    renderGame(makeConfig({
      questions: [
        { question: 'Beispiel Q', answerList: ['x'] },
        { question: 'Letzte Frage', answer: 'Eins, Zwei' },
      ],
    }));
    await waitFor(() => expect(screen.getByText('Test WKM')).toBeInTheDocument());
    await advanceToGame();

    await navForward(user); // reveal Beispiel
    await navForward(user); // advance to the last question
    await waitFor(() => expect(screen.getByText('Frage 1 von 1')).toBeInTheDocument());

    await navForward(user); // reveal
    await user.click(screen.getByRole('button', { name: 'Team 2' }));
    await user.type(screen.getByPlaceholderText('Anzahl'), '7');
    await user.click(screen.getByRole('button', { name: 'Punkte vergeben' }));

    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team2', 7);
    await waitFor(() => expect(defaultProps.onNextGame).toHaveBeenCalled());
  });
});

describe('WerKenntMehr — standard scoring mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).Audio = class MockAudio {
      src = '';
      volume = 1;
      paused = true;
      play = vi.fn().mockResolvedValue(undefined);
      pause = vi.fn();
      load = vi.fn();
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      constructor(src?: string) { if (src) this.src = src; }
    };
  });

  function renderStandard(currentIndex = 3, questions?: WerKenntMehrConfig['questions']) {
    const config = makeConfig({ scoringMode: 'standard', ...(questions ? { questions } : {}) });
    return render(
      <MemoryRouter>
        <GameProvider>
          <MusicProvider>
            <WerKenntMehr {...defaultProps} currentIndex={currentIndex} config={config} />
          </MusicProvider>
        </GameProvider>
      </MemoryRouter>
    );
  }

  it('shows no per-round scoring controls and advances on nav-forward', async () => {
    const user = userEvent.setup();
    renderStandard();
    await waitFor(() => expect(screen.getByText('Test WKM')).toBeInTheDocument());
    await advanceToGame();
    await navForward(user); // reveal Beispiel
    await navForward(user); // advance to Frage 1
    await waitFor(() => expect(screen.getByText('Frage 1 von 2')).toBeInTheDocument());
    await navForward(user); // reveal Frage 1
    await waitFor(() => expect(screen.getByText('Berlin')).toBeInTheDocument());

    // The answer is revealed but there is NO scoring panel: no count input, no
    // commit button, no team toggles — just the examples.
    expect(screen.queryByPlaceholderText('Anzahl')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Runde werten' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Team 1' })).not.toBeInTheDocument();
    expect(document.querySelector('.bet-quiz-host-panel')).not.toBeInTheDocument();

    // nav-forward continues to the next question even without any per-round score.
    await navForward(user);
    await waitFor(() => expect(screen.getByText('Frage 2 von 2')).toBeInTheDocument());
  });

  it('awards the positional game points on the end reward screen (not a per-question count)', async () => {
    const user = userEvent.setup();
    renderStandard(3); // pointValue = currentIndex + 1 = 4
    await waitFor(() => expect(screen.getByText('Test WKM')).toBeInTheDocument());
    await advanceToGame();
    await navForward(user); // reveal Beispiel
    await navForward(user); // -> Frage 1
    await waitFor(() => expect(screen.getByText('Frage 1 von 2')).toBeInTheDocument());

    // Play through both real rounds with no scoring — just reveal + advance.
    await navForward(user); // reveal Frage 1
    await navForward(user); // -> Frage 2
    await waitFor(() => expect(screen.getByText('Frage 2 von 2')).toBeInTheDocument());
    await navForward(user); // reveal Frage 2
    await navForward(user); // -> reward screen (last question)

    // No points were awarded during the rounds.
    await waitFor(() => expect(screen.getByText('Punkte vergeben')).toBeInTheDocument());
    expect(defaultProps.onAwardPoints).not.toHaveBeenCalled();

    // Host picks the overall winner -> the game's positional points (4), once.
    await user.click(screen.getByRole('button', { name: 'Team 1' }));
    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team1', 4);
    expect(defaultProps.onAwardPoints).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(defaultProps.onNextGame).toHaveBeenCalled());
  });

  it('awards positional points to both teams when the host picks Unentschieden', async () => {
    const user = userEvent.setup();
    renderStandard(2); // pointValue = 3
    await waitFor(() => expect(screen.getByText('Test WKM')).toBeInTheDocument());
    await advanceToGame();
    await navForward(user); // reveal Beispiel
    await navForward(user); // -> Frage 1
    await waitFor(() => expect(screen.getByText('Frage 1 von 2')).toBeInTheDocument());

    await navForward(user); // reveal Frage 1
    await navForward(user); // -> Frage 2
    await waitFor(() => expect(screen.getByText('Frage 2 von 2')).toBeInTheDocument());
    await navForward(user); // reveal Frage 2
    await navForward(user); // -> reward screen

    await waitFor(() => expect(screen.getByText('Punkte vergeben')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Unentschieden' }));
    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team1', 3);
    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team2', 3);
    expect(defaultProps.onAwardPoints).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(defaultProps.onNextGame).toHaveBeenCalled());
  });
});

describe('WerKenntMehr — count-penalty scoring mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).Audio = class MockAudio {
      src = '';
      volume = 1;
      paused = true;
      play = vi.fn().mockResolvedValue(undefined);
      pause = vi.fn();
      load = vi.fn();
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      constructor(src?: string) { if (src) this.src = src; }
    };
  });

  function renderPenalty() {
    return renderGame(makeConfig({ scoringMode: 'count-penalty' }));
  }

  it('awards the count to the winner and subtracts it from the loser (team1 wins)', async () => {
    const user = userEvent.setup();
    renderPenalty();
    await waitFor(() => expect(screen.getByText('Test WKM')).toBeInTheDocument());
    await advanceToGame();
    await navForward(user); // reveal Beispiel
    await navForward(user); // advance to question 1
    await waitFor(() => expect(screen.getByText('Frage 1 von 2')).toBeInTheDocument());
    await navForward(user); // reveal examples + scoring panel
    await waitFor(() => expect(screen.getByText('Berlin')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Team 1' }));
    await user.type(screen.getByPlaceholderText('Anzahl'), '12');
    await user.click(screen.getByRole('button', { name: 'Punkte vergeben' }));

    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team1', 12);
    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team2', -12);
    expect(defaultProps.onAwardPoints).toHaveBeenCalledTimes(2);
  });

  it('awards the count to the winner and subtracts it from the loser (team2 wins)', async () => {
    const user = userEvent.setup();
    renderPenalty();
    await waitFor(() => expect(screen.getByText('Test WKM')).toBeInTheDocument());
    await advanceToGame();
    await navForward(user); // reveal Beispiel
    await navForward(user); // advance to question 1
    await waitFor(() => expect(screen.getByText('Frage 1 von 2')).toBeInTheDocument());
    await navForward(user); // reveal
    await waitFor(() => expect(screen.getByText('Berlin')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Team 2' }));
    await user.type(screen.getByPlaceholderText('Anzahl'), '8');
    await user.click(screen.getByRole('button', { name: 'Punkte vergeben' }));

    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team2', 8);
    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team1', -8);
    expect(defaultProps.onAwardPoints).toHaveBeenCalledTimes(2);
  });

  it('changes nothing on a tie (both teams selected)', async () => {
    const user = userEvent.setup();
    renderPenalty();
    await waitFor(() => expect(screen.getByText('Test WKM')).toBeInTheDocument());
    await advanceToGame();
    await navForward(user); // reveal Beispiel
    await navForward(user); // advance to question 1
    await waitFor(() => expect(screen.getByText('Frage 1 von 2')).toBeInTheDocument());
    await navForward(user); // reveal
    await waitFor(() => expect(screen.getByText('Berlin')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Team 1' }));
    await user.click(screen.getByRole('button', { name: 'Team 2' }));
    // Tie hint is mode-specific: no split, no penalty.
    expect(screen.getByText('Unentschieden — keine Punkteänderung.')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('Anzahl'), '10');
    await user.click(screen.getByRole('button', { name: 'Punkte vergeben' }));

    expect(defaultProps.onAwardPoints).not.toHaveBeenCalled();
    // Still advances to the next question.
    await waitFor(() => expect(screen.getByText('Frage 2 von 2')).toBeInTheDocument());
  });
});

describe('WerKenntMehr — default scoring mode (no scoringMode set)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).Audio = class MockAudio {
      src = '';
      volume = 1;
      paused = true;
      play = vi.fn().mockResolvedValue(undefined);
      pause = vi.fn();
      load = vi.fn();
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      constructor(src?: string) { if (src) this.src = src; }
    };
  });

  it('defaults to standard scoring when scoringMode is unset (no per-round count panel)', async () => {
    const user = userEvent.setup();
    // Override the helper's 'count' default back to undefined to exercise the real
    // game-wide default.
    renderGame(makeConfig({ scoringMode: undefined }));
    await waitFor(() => expect(screen.getByText('Test WKM')).toBeInTheDocument());
    await advanceToGame();
    await navForward(user); // reveal Beispiel
    await navForward(user); // -> Frage 1
    await waitFor(() => expect(screen.getByText('Frage 1 von 2')).toBeInTheDocument());
    await navForward(user); // reveal Frage 1
    await waitFor(() => expect(screen.getByText('Berlin')).toBeInTheDocument());

    // Standard behaviour: NO per-round scoring panel, no count input.
    expect(screen.queryByPlaceholderText('Anzahl')).not.toBeInTheDocument();
    expect(document.querySelector('.bet-quiz-host-panel')).not.toBeInTheDocument();

    // nav-forward keeps advancing (no per-round score).
    await navForward(user);
    await waitFor(() => expect(screen.getByText('Frage 2 von 2')).toBeInTheDocument());
  });
});

// Regression: a live show where wer-kennt-mehr's per-question 120s timer "did not
// start" while the GM still showed it as a running timer. Root cause: a GM
// deadline countdown was active, which suppresses (hides) the per-question Timer
// on the show, but the game kept reporting it as active to the GM. Once a deadline
// is active — including the lingering "Zeit abgelaufen!" badge window after it
// expires — the per-question timer must report itself INACTIVE to the GM.
describe('WerKenntMehr — GM deadline overrides the per-question timer', () => {
  function readTimerActive(): boolean | undefined {
    const raw = localStorage.getItem('gm:last-controls');
    return raw ? JSON.parse(raw).timerActive : undefined;
  }

  it('reports the per-question timer as inactive to the GM while a deadline is active and after it expires', () => {
    vi.useFakeTimers();
    try {
      const config = makeConfig({
        questions: [
          { question: 'Beispiel Q', answerList: ['x', 'y'], timer: 120 },
          { question: 'Hauptstädte', answerList: ['Berlin'], timer: 120 },
        ],
      });
      renderGame(config);

      // landing -> rules -> game (fake-timer safe; no userEvent).
      act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
      act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });

      // Per-question 120s timer runs on the show → GM sees it active.
      expect(screen.getByText('120')).toBeInTheDocument();
      expect(readTimerActive()).toBe(true);

      // GM starts a deadline countdown → per-question Timer is hidden on the show.
      act(() => { __emitChannelForTests('gamemaster-command', { controlId: 'deadline-5', timestamp: Date.now() }); });
      expect(screen.getByText('5')).toBeInTheDocument();
      expect(screen.queryByText('120')).toBeNull();

      // Let the deadline expire. During the "Zeit abgelaufen!" badge window the
      // per-question timer is still suppressed, so the GM must NOT be told a timer
      // is running (pre-fix this stayed true → the bug).
      act(() => { vi.advanceTimersByTime(5000); });
      expect(readTimerActive()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

// Standard mode is a positional-points game that (unlike the count modes) also
// honors the Aufholjoker, and — new — lets the gamemaster keep a round-win tally.
describe('WerKenntMehr — standard mode: Aufholjoker + round-win tally', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    (globalThis as any).Audio = class MockAudio {
      src = '';
      volume = 1;
      paused = true;
      play = vi.fn().mockResolvedValue(undefined);
      pause = vi.fn();
      load = vi.fn();
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      constructor(src?: string) { if (src) this.src = src; }
    };
  });

  function renderStd(currentIndex = 3) {
    return render(
      <MemoryRouter>
        <GameProvider>
          <MusicProvider>
            <WerKenntMehr {...defaultProps} currentIndex={currentIndex} config={makeConfig({ scoringMode: 'standard' })} />
          </MusicProvider>
        </GameProvider>
      </MemoryRouter>
    );
  }

  /** Play the default 2-real-question standard game to the summary reward screen. */
  async function playToSummary(user: ReturnType<typeof userEvent.setup>) {
    await waitFor(() => expect(screen.getByText('Test WKM')).toBeInTheDocument());
    await advanceToGame();
    await navForward(user); // reveal Beispiel
    await navForward(user); // -> Frage 1
    await waitFor(() => expect(screen.getByText('Frage 1 von 2')).toBeInTheDocument());
    await navForward(user); // reveal Frage 1
    await navForward(user); // -> Frage 2
    await waitFor(() => expect(screen.getByText('Frage 2 von 2')).toBeInTheDocument());
    await navForward(user); // reveal Frage 2
    await navForward(user); // -> summary reward screen
    await waitFor(() => expect(screen.getByText('Punkte vergeben')).toBeInTheDocument());
  }

  it('doubles the armed team’s positional points on the summary reward (Aufholjoker)', async () => {
    localStorage.setItem('doubleNextGame', 'team1');
    const user = userEvent.setup();
    renderStd(3); // pointValue = currentIndex + 1 = 4
    await playToSummary(user);

    // The armed team's award button carries the ×2 badge; the other team's does not.
    const team1Btn = screen.getByRole('button', { name: /Team 1/ });
    expect(team1Btn).toHaveTextContent('×2 Aufholjoker');
    expect(screen.getByRole('button', { name: /Team 2/ })).not.toHaveTextContent('×2 Aufholjoker');

    await user.click(team1Btn);
    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team1', 8); // 4 * 2
    expect(defaultProps.onAwardPoints).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(defaultProps.onNextGame).toHaveBeenCalled());
    // The armed flag is consumed once the inline-scored game completes.
    await waitFor(() => expect(localStorage.getItem('doubleNextGame')).toBeNull());
  });

  it('does NOT double the non-armed team', async () => {
    localStorage.setItem('doubleNextGame', 'team2');
    const user = userEvent.setup();
    renderStd(3); // pointValue = 4
    await playToSummary(user);

    await user.click(screen.getByRole('button', { name: 'Team 1' }));
    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team1', 4); // not doubled
    expect(defaultProps.onAwardPoints).toHaveBeenCalledTimes(1);
  });

  it('on a draw, doubles only the armed team', async () => {
    localStorage.setItem('doubleNextGame', 'team1');
    const user = userEvent.setup();
    renderStd(2); // pointValue = 3
    await playToSummary(user);

    await user.click(screen.getByRole('button', { name: 'Unentschieden' }));
    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team1', 6); // 3 * 2
    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team2', 3); // unchanged
    expect(defaultProps.onAwardPoints).toHaveBeenCalledTimes(2);
  });

  it('accumulates a GM round-win tally and shows it on the summary screen', async () => {
    const user = userEvent.setup();
    renderStd(0);
    await waitFor(() => expect(screen.getByText('Test WKM')).toBeInTheDocument());
    await advanceToGame();
    await navForward(user); // reveal Beispiel
    await navForward(user); // -> Frage 1
    await waitFor(() => expect(screen.getByText('Frage 1 von 2')).toBeInTheDocument());
    await navForward(user); // reveal Frage 1 (qIdx = 1)
    // GM records team1 as the round winner (GM-only control — no on-show panel).
    act(() => { __emitChannelForTests('gamemaster-command', { controlId: 'round-team1', timestamp: Date.now() }); });
    await navForward(user); // -> Frage 2
    await waitFor(() => expect(screen.getByText('Frage 2 von 2')).toBeInTheDocument());
    await navForward(user); // reveal Frage 2 (qIdx = 2)
    act(() => { __emitChannelForTests('gamemaster-command', { controlId: 'round-team1', timestamp: Date.now() }); });
    await navForward(user); // -> summary
    await waitFor(() => expect(screen.getByText('Punkte vergeben')).toBeInTheDocument());

    const tally = document.querySelector('.wkm-tally');
    expect(tally).toBeInTheDocument();
    expect(tally?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Rundenstand: Team 1 2 – 0 Team 2');
  });

  it('clears a round-win record when the same winner is tapped again (no tally shown)', async () => {
    const user = userEvent.setup();
    renderStd(0);
    await waitFor(() => expect(screen.getByText('Test WKM')).toBeInTheDocument());
    await advanceToGame();
    await navForward(user); // reveal Beispiel
    await navForward(user); // -> Frage 1
    await waitFor(() => expect(screen.getByText('Frage 1 von 2')).toBeInTheDocument());
    await navForward(user); // reveal Frage 1 (qIdx = 1)
    // Record, then tap the same button again to clear it — the entry is removed,
    // not left as a phantom draw (guards the delete path in the command handler).
    // Timestamps must strictly increase or the GM-command listener dedupes the
    // second tap (see useGamemasterCommandListener).
    const ts = Date.now();
    act(() => { __emitChannelForTests('gamemaster-command', { controlId: 'round-team1', timestamp: ts }); });
    act(() => { __emitChannelForTests('gamemaster-command', { controlId: 'round-team1', timestamp: ts + 1 }); });
    await navForward(user); // -> Frage 2
    await navForward(user); // reveal Frage 2
    await navForward(user); // -> summary
    await waitFor(() => expect(screen.getByText('Punkte vergeben')).toBeInTheDocument());

    // Nothing recorded → the guidance tally line is not rendered at all.
    expect(document.querySelector('.wkm-tally')).not.toBeInTheDocument();
  });
});
