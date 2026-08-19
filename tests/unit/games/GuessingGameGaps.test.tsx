import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import GuessingGame from '@/components/games/GuessingGame';
import type { GuessingGameConfig } from '@/types/config';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
  }),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
}));

const defaultProps = {
  gameId: 'game-1',
  currentIndex: 0,
  totalGames: 5,
  pointSystemEnabled: true,
  onNextGame: vi.fn(),
  onAwardPoints: vi.fn(),
};

function makeConfig(overrides: Partial<GuessingGameConfig> = {}): GuessingGameConfig {
  return {
    type: 'guessing-game',
    title: 'Test Guessing',
    rules: ['Guess the number'],
    questions: [
      { question: 'Example Q', answer: 100 },
      { question: 'Q1', answer: 50 },
    ],
    ...overrides,
  };
}

function renderGame(config?: GuessingGameConfig) {
  return render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <GuessingGame {...defaultProps} config={config || makeConfig()} />
        </MusicProvider>
      </GameProvider>
    </MemoryRouter>
  );
}

function advanceToGame() {
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
}

describe('GuessingGame - Gaps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultProps.onNextGame = vi.fn();
    defaultProps.onAwardPoints = vi.fn();
  });

  it('completes game after last question result', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: 'Example', answer: 100 },
        { question: 'Last Q', answer: 50 },
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    advanceToGame();

    // Example: fill guesses and submit
    await waitFor(() => expect(screen.getByText('Example')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Tipp Team 1:'), '80');
    await user.type(screen.getByLabelText('Tipp Team 2:'), '120');
    await user.click(screen.getByText('Tipp Abgeben'));

    // Advance to next question
    await clickForward(user);

    // Last Q: fill and submit
    await waitFor(() => expect(screen.getByText('Last Q')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Tipp Team 1:'), '40');
    await user.type(screen.getByLabelText('Tipp Team 2:'), '60');
    await user.click(screen.getByText('Tipp Abgeben'));

    // Advance past result (game complete)
    await clickForward(user);

    await waitFor(() => {
      expect(screen.getByText('Punkte vergeben')).toBeInTheDocument();
    });
  });

  it('does not advance from question phase (only from result)', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    advanceToGame();

    // In question phase, clicking (via ArrowRight/click) should not advance
    await clickForward(user);

    // Still on same question (form still visible)
    expect(screen.getByText('Tipp Abgeben')).toBeInTheDocument();
  });

  it('shows "Beispiel Frage" for first question', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    advanceToGame();

    await waitFor(() => {
      expect(screen.getByText('Beispiel Frage')).toBeInTheDocument();
    });
  });

  it('shows correct question numbering for non-example', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    advanceToGame();

    // Submit example
    await user.type(screen.getByLabelText('Tipp Team 1:'), '80');
    await user.type(screen.getByLabelText('Tipp Team 2:'), '120');
    await user.click(screen.getByText('Tipp Abgeben'));

    // Advance to next question
    await clickForward(user);

    await waitFor(() => {
      expect(screen.getByText('Frage 1 von 1')).toBeInTheDocument();
    });
  });

  it('resets form fields when advancing to next question', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    advanceToGame();

    // Submit example with values
    await user.type(screen.getByLabelText('Tipp Team 1:'), '80');
    await user.type(screen.getByLabelText('Tipp Team 2:'), '120');
    await user.click(screen.getByText('Tipp Abgeben'));

    // Advance to Q1
    await clickForward(user);

    await waitFor(() => {
      const t1Input = screen.getByLabelText('Tipp Team 1:') as HTMLInputElement;
      const t2Input = screen.getByLabelText('Tipp Team 2:') as HTMLInputElement;
      expect(t1Input.value).toBe('');
      expect(t2Input.value).toBe('');
    });
  });

  it('shows answer image when provided', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: 'Q', answer: 50, answerImage: '/images/answer.jpg' },
        { question: 'Q2', answer: 100 },
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    advanceToGame();

    await user.type(screen.getByLabelText('Tipp Team 1:'), '40');
    await user.type(screen.getByLabelText('Tipp Team 2:'), '60');
    await user.click(screen.getByText('Tipp Abgeben'));

    await waitFor(() => {
      const img = document.querySelector('.quiz-image') as HTMLImageElement;
      expect(img).toBeInTheDocument();
      expect(img.src).toContain('/images/answer.jpg');
    });
  });

  it('keeps the manual winner selection under scoringMode "standard"', async () => {
    const user = userEvent.setup();
    renderGame(makeConfig({ scoringMode: 'standard' }));
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    advanceToGame();

    await user.type(screen.getByLabelText('Tipp Team 1:'), '80');
    await user.type(screen.getByLabelText('Tipp Team 2:'), '120');
    await user.click(screen.getByText('Tipp Abgeben'));
    await clickForward(user);

    await user.type(screen.getByLabelText('Tipp Team 1:'), '45');
    await user.type(screen.getByLabelText('Tipp Team 2:'), '90');
    await user.click(screen.getByText('Tipp Abgeben'));
    await clickForward(user);

    await waitFor(() => expect(screen.getByText('Welches Team hat gewonnen?')).toBeInTheDocument());
    expect(screen.getByText('Unentschieden')).toBeInTheDocument();
    expect(screen.queryByText('Punkte vergeben & weiter')).not.toBeInTheDocument();
  });

  it('falls back to the manual selection when automatic scoring judged no real question', async () => {
    const user = userEvent.setup();
    // Only the example question — nothing counts, so there is no verdict to state.
    const config = makeConfig({
      questions: [{ question: 'Example only', answer: 100 }],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    advanceToGame();

    await user.type(screen.getByLabelText('Tipp Team 1:'), '80');
    await user.type(screen.getByLabelText('Tipp Team 2:'), '120');
    await user.click(screen.getByText('Tipp Abgeben'));
    await clickForward(user);

    await waitFor(() => expect(screen.getByText('Welches Team hat gewonnen?')).toBeInTheDocument());
    expect(screen.getByText('Unentschieden')).toBeInTheDocument();
  });

  it('handles zero guesses gracefully', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    advanceToGame();

    // Submit with empty values (defaults to 0)
    await user.type(screen.getByLabelText('Tipp Team 1:'), '0');
    await user.type(screen.getByLabelText('Tipp Team 2:'), '0');
    await user.click(screen.getByText('Tipp Abgeben'));

    // A tie badges both team cards
    await waitFor(() => {
      expect(screen.getAllByText('Gleichstand!')).toHaveLength(2);
    });
  });
});

async function clickForward(user: ReturnType<typeof userEvent.setup>) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  await user.click(div);
  document.body.removeChild(div);
}
