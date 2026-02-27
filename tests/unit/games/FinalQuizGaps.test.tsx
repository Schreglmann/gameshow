import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import FinalQuiz from '@/components/games/FinalQuiz';
import type { FinalQuizConfig, FinalQuizQuestion } from '@/types/config';

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

function makeConfig(overrides: Partial<FinalQuizConfig> = {}): FinalQuizConfig {
  return {
    type: 'final-quiz',
    title: 'Final Round',
    rules: ['Bet your points'],
    questions: [
      { question: 'Example Q', answer: 'Example A' },
      { question: 'Q1', answer: 'A1' },
      { question: 'Q2', answer: 'A2' },
    ] as FinalQuizQuestion[],
    ...overrides,
  };
}

function renderGame(config?: FinalQuizConfig) {
  return render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <FinalQuiz {...defaultProps} config={config || makeConfig()} />
        </MusicProvider>
      </GameProvider>
    </MemoryRouter>
  );
}

function advanceToGame() {
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
}

async function clickForward(user: ReturnType<typeof userEvent.setup>) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  await user.click(div);
  document.body.removeChild(div);
}

describe('FinalQuiz - Gaps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultProps.onNextGame = vi.fn();
    defaultProps.onAwardPoints = vi.fn();
  });

  it('shows question phase initially', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Final Round')).toBeInTheDocument());
    advanceToGame();

    await waitFor(() => {
      expect(screen.getByText('Example Q')).toBeInTheDocument();
      expect(screen.getByText('Beispiel')).toBeInTheDocument();
    });
  });

  it('transitions from question to betting phase on click', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Final Round')).toBeInTheDocument());
    advanceToGame();

    await waitFor(() => expect(screen.getByText('Example Q')).toBeInTheDocument());

    // Click to advance to betting
    await clickForward(user);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Gesetzte Punkte Team 1')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Gesetzte Punkte Team 2')).toBeInTheDocument();
      expect(screen.getByText('Antwort anzeigen')).toBeInTheDocument();
    });
  });

  it('shows answer and judging after clicking Antwort anzeigen', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Final Round')).toBeInTheDocument());
    advanceToGame();
    await clickForward(user); // to betting

    await waitFor(() => expect(screen.getByText('Antwort anzeigen')).toBeInTheDocument());

    // Enter bets
    await user.type(screen.getByPlaceholderText('Gesetzte Punkte Team 1'), '10');
    await user.type(screen.getByPlaceholderText('Gesetzte Punkte Team 2'), '5');

    // Show answer
    await user.click(screen.getByText('Antwort anzeigen'));

    await waitFor(() => {
      expect(screen.getByText('Example A')).toBeInTheDocument();
      // Judging buttons
      expect(screen.getAllByText('Richtig')).toHaveLength(2);
      expect(screen.getAllByText('Falsch')).toHaveLength(2);
    });
  });

  it('does not award points for example questions', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Final Round')).toBeInTheDocument());
    advanceToGame();
    await clickForward(user); // to betting

    await waitFor(() => expect(screen.getByText('Antwort anzeigen')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('Gesetzte Punkte Team 1'), '10');
    await user.type(screen.getByPlaceholderText('Gesetzte Punkte Team 2'), '5');
    await user.click(screen.getByText('Antwort anzeigen'));

    // Judge both teams
    await waitFor(() => expect(screen.getAllByText('Richtig').length).toBe(2));

    // Team 1 correct
    const richtigButtons = screen.getAllByText('Richtig');
    await user.click(richtigButtons[0]); // Team 1 correct
    await user.click(screen.getAllByText('Falsch')[1]); // Team 2 incorrect

    // Example question: no award call
    expect(defaultProps.onAwardPoints).not.toHaveBeenCalled();
  });

  it('awards points for non-example questions', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: 'Example', answer: 'Ex A' },
        { question: 'Real Q', answer: 'Real A' },
      ] as FinalQuizQuestion[],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Final Round')).toBeInTheDocument());
    advanceToGame();

    // Skip example: question → betting → show answer → judge → advance
    await clickForward(user); // to betting
    await waitFor(() => expect(screen.getByText('Antwort anzeigen')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('Gesetzte Punkte Team 1'), '10');
    await user.type(screen.getByPlaceholderText('Gesetzte Punkte Team 2'), '5');
    await user.click(screen.getByText('Antwort anzeigen'));
    await waitFor(() => expect(screen.getAllByText('Richtig').length).toBe(2));
    await user.click(screen.getAllByText('Richtig')[0]);
    await user.click(screen.getAllByText('Falsch')[1]);

    // Advance to real question (click the judging "Nächste Frage" or via ArrowRight)
    const nextBtn = screen.getByText('Nächste Frage');
    await user.click(nextBtn);

    // Now on real question
    await waitFor(() => expect(screen.getByText('Real Q')).toBeInTheDocument());

    // Go through full cycle on real question
    await clickForward(user); // to betting
    await waitFor(() => expect(screen.getByText('Antwort anzeigen')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('Gesetzte Punkte Team 1'), '8');
    await user.type(screen.getByPlaceholderText('Gesetzte Punkte Team 2'), '3');
    await user.click(screen.getByText('Antwort anzeigen'));

    await waitFor(() => expect(screen.getAllByText('Richtig').length).toBe(2));
    await user.click(screen.getAllByText('Richtig')[0]); // Team 1 correct → +8
    await user.click(screen.getAllByText('Falsch')[1]); // Team 2 incorrect → -3

    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team1', 8);
    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team2', -3);
  });

  it('reverses judgment when changing answer', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: 'Example', answer: 'A' },
        { question: 'Real', answer: 'B' },
      ] as FinalQuizQuestion[],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Final Round')).toBeInTheDocument());
    advanceToGame();

    // Skip example
    await clickForward(user); // betting
    await waitFor(() => expect(screen.getByText('Antwort anzeigen')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('Gesetzte Punkte Team 1'), '5');
    await user.type(screen.getByPlaceholderText('Gesetzte Punkte Team 2'), '5');
    await user.click(screen.getByText('Antwort anzeigen'));
    await waitFor(() => expect(screen.getAllByText('Richtig').length).toBe(2));
    await user.click(screen.getAllByText('Richtig')[0]);
    await user.click(screen.getAllByText('Richtig')[1]);
    await user.click(screen.getByText('Nächste Frage'));

    // Real question
    await waitFor(() => expect(screen.getByText('Real')).toBeInTheDocument());
    await clickForward(user);
    await waitFor(() => expect(screen.getByText('Antwort anzeigen')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('Gesetzte Punkte Team 1'), '10');
    await user.type(screen.getByPlaceholderText('Gesetzte Punkte Team 2'), '10');
    await user.click(screen.getByText('Antwort anzeigen'));

    await waitFor(() => expect(screen.getAllByText('Richtig').length).toBe(2));

    // First: Team 1 correct (+10)
    await user.click(screen.getAllByText('Richtig')[0]);
    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team1', 10);

    // Change: Team 1 incorrect (reverse +10, then apply -10)
    await user.click(screen.getAllByText('Falsch')[0]);
    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team1', -10); // reverse
    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team1', -10); // new judgment
  });

  it('shows answerImage when provided', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: 'Q', answer: 'A', answerImage: '/images/final.jpg' } as FinalQuizQuestion,
        { question: 'Q2', answer: 'A2' } as FinalQuizQuestion,
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Final Round')).toBeInTheDocument());
    advanceToGame();
    await clickForward(user); // betting
    await waitFor(() => expect(screen.getByText('Antwort anzeigen')).toBeInTheDocument());
    await user.click(screen.getByText('Antwort anzeigen'));

    await waitFor(() => {
      const img = document.querySelector('.quiz-image') as HTMLImageElement;
      expect(img).toBeInTheDocument();
      expect(img.src).toContain('/images/final.jpg');
    });
  });

  it('disables Weiter button until both teams are judged', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: 'Ex', answer: 'A' },
        { question: 'Real', answer: 'B' },
      ] as FinalQuizQuestion[],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Final Round')).toBeInTheDocument());
    advanceToGame();
    await clickForward(user);
    await waitFor(() => expect(screen.getByText('Antwort anzeigen')).toBeInTheDocument());
    await user.click(screen.getByText('Antwort anzeigen'));

    await waitFor(() => {
      const nextBtn = screen.getByText('Nächste Frage');
      expect(nextBtn).toBeDisabled();
    });

    // Judge team 1 only
    await user.click(screen.getAllByText('Richtig')[0]);
    expect(screen.getByText('Nächste Frage')).toBeDisabled();

    // Judge team 2
    await user.click(screen.getAllByText('Richtig')[1]);
    expect(screen.getByText('Nächste Frage')).not.toBeDisabled();
  });

  it('completes game after last real question', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: 'Example', answer: 'A' },
        { question: 'Last Q', answer: 'Last A' },
      ] as FinalQuizQuestion[],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Final Round')).toBeInTheDocument());
    advanceToGame();

    // Example flow
    await clickForward(user);
    await waitFor(() => expect(screen.getByText('Antwort anzeigen')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('Gesetzte Punkte Team 1'), '1');
    await user.type(screen.getByPlaceholderText('Gesetzte Punkte Team 2'), '1');
    await user.click(screen.getByText('Antwort anzeigen'));
    await waitFor(() => expect(screen.getAllByText('Richtig').length).toBe(2));
    await user.click(screen.getAllByText('Richtig')[0]);
    await user.click(screen.getAllByText('Richtig')[1]);
    await user.click(screen.getByText('Nächste Frage'));

    // Last Q flow
    await waitFor(() => expect(screen.getByText('Last Q')).toBeInTheDocument());
    await clickForward(user);
    await waitFor(() => expect(screen.getByText('Antwort anzeigen')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('Gesetzte Punkte Team 1'), '5');
    await user.type(screen.getByPlaceholderText('Gesetzte Punkte Team 2'), '5');
    await user.click(screen.getByText('Antwort anzeigen'));
    await waitFor(() => expect(screen.getAllByText('Richtig').length).toBe(2));
    await user.click(screen.getAllByText('Richtig')[0]);
    await user.click(screen.getAllByText('Falsch')[1]);

    // Click "Weiter" (last question button text)
    await user.click(screen.getByText('Weiter'));

    // Game should complete → show next game (skipPointsScreen=true → "Nächstes Spiel")
    await waitFor(() => {
      expect(screen.getByText('Nächstes Spiel')).toBeInTheDocument();
    });
  });
});
