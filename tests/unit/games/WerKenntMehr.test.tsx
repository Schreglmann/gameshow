import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import WerKenntMehr from '@/components/games/WerKenntMehr';
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
