import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import Quizjagd from '@/components/games/Quizjagd';
import type { QuizjagdConfig } from '@/types/config';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
  }),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
}));

const onAwardPoints = vi.fn();
const onNextGame = vi.fn();

const defaultProps = {
  gameId: 'game-1',
  currentIndex: 0,
  totalGames: 5,
  pointSystemEnabled: true,
  onNextGame,
  onAwardPoints,
};

function makeConfig(overrides: Partial<QuizjagdConfig> = {}): QuizjagdConfig {
  return {
    type: 'quizjagd',
    title: 'Quiz Chase',
    rules: ['Pick difficulty'],
    questionsPerTeam: 2,
    questions: {
      easy: [
        { question: 'Easy Q1', answer: 'Easy A1' },
        { question: 'Easy Q2', answer: 'Easy A2' },
        { question: 'Easy Q3', answer: 'Easy A3' },
        { question: 'Easy Q4', answer: 'Easy A4' },
      ],
      medium: [
        { question: 'Med Q1', answer: 'Med A1' },
        { question: 'Med Q2', answer: 'Med A2' },
        { question: 'Med Q3', answer: 'Med A3' },
        { question: 'Med Q4', answer: 'Med A4' },
      ],
      hard: [
        { question: 'Hard Q1', answer: 'Hard A1' },
        { question: 'Hard Q2', answer: 'Hard A2' },
        { question: 'Hard Q3', answer: 'Hard A3' },
        { question: 'Hard Q4', answer: 'Hard A4' },
      ],
    },
    ...overrides,
  } as QuizjagdConfig;
}

function renderGame(config?: QuizjagdConfig) {
  return render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <Quizjagd {...defaultProps} config={config || makeConfig()} />
        </MusicProvider>
      </GameProvider>
    </MemoryRouter>
  );
}

async function advanceToGame(_user: ReturnType<typeof userEvent.setup>) {
  // Landing -> Rules
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  });
  // Rules -> Game
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  });
}

describe('Quizjagd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders landing screen with title', async () => {
    renderGame();
    await waitFor(() => {
      expect(screen.getByText('Quiz Chase')).toBeInTheDocument();
    });
  });

  it('shows difficulty selection buttons', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Quiz Chase')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      expect(screen.getByText('3 Punkte (Leicht)')).toBeInTheDocument();
      expect(screen.getByText('5 Punkte (Mittel)')).toBeInTheDocument();
      expect(screen.getByText('7 Punkte (Schwer)')).toBeInTheDocument();
    });
  });

  it('shows team label', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Quiz Chase')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      expect(screen.getByText(/Team 1 ist dran/)).toBeInTheDocument();
    });
  });

  it('shows question after selecting easy difficulty (3 pts)', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Quiz Chase')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByText('3 Punkte (Leicht)')).toBeInTheDocument());
    await user.click(screen.getByText('3 Punkte (Leicht)'));

    await waitFor(() => {
      // Should show a question from the easy pool
      const questionEl = document.querySelector('.quiz-question');
      expect(questionEl).toBeInTheDocument();
      expect(questionEl!.textContent).toMatch(/Easy Q/);
    });
  });

  it('shows question after selecting medium difficulty (5 pts)', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Quiz Chase')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByText('5 Punkte (Mittel)')).toBeInTheDocument());
    await user.click(screen.getByText('5 Punkte (Mittel)'));

    await waitFor(() => {
      const questionEl = document.querySelector('.quiz-question');
      expect(questionEl).toBeInTheDocument();
      expect(questionEl!.textContent).toMatch(/Med Q/);
    });
  });

  it('shows question after selecting hard difficulty (7 pts)', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Quiz Chase')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByText('7 Punkte (Schwer)')).toBeInTheDocument());
    await user.click(screen.getByText('7 Punkte (Schwer)'));

    await waitFor(() => {
      const questionEl = document.querySelector('.quiz-question');
      expect(questionEl).toBeInTheDocument();
      expect(questionEl!.textContent).toMatch(/Hard Q/);
    });
  });

  it('reveals answer and shows Richtig/Falsch buttons on click', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Quiz Chase')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByText('3 Punkte (Leicht)')).toBeInTheDocument());
    await user.click(screen.getByText('3 Punkte (Leicht)'));

    // Click to reveal answer
    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div);
    document.body.removeChild(div);

    await waitFor(() => {
      const answerEl = document.querySelector('.quiz-answer');
      expect(answerEl).toBeInTheDocument();
      expect(screen.getByText(/Richtig/)).toBeInTheDocument();
      expect(screen.getByText(/Falsch/)).toBeInTheDocument();
    });
  });

  it('awards positive points for correct answer', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Quiz Chase')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByText('3 Punkte (Leicht)')).toBeInTheDocument());
    await user.click(screen.getByText('3 Punkte (Leicht)'));

    // Reveal and judge correct
    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div);
    document.body.removeChild(div);

    await waitFor(() => expect(screen.getByText(/Richtig/)).toBeInTheDocument());
    await user.click(screen.getByText(/Richtig/));

    expect(onAwardPoints).toHaveBeenCalledWith('team1', 3);
  });

  it('awards negative points for incorrect answer', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Quiz Chase')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByText('5 Punkte (Mittel)')).toBeInTheDocument());
    await user.click(screen.getByText('5 Punkte (Mittel)'));

    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div);
    document.body.removeChild(div);

    await waitFor(() => expect(screen.getByText(/Falsch/)).toBeInTheDocument());
    await user.click(screen.getByText(/Falsch/));

    expect(onAwardPoints).toHaveBeenCalledWith('team1', -5);
  });

  it('alternates teams after each question', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Quiz Chase')).toBeInTheDocument());
    await advanceToGame(user);

    // Team 1 first
    await waitFor(() => expect(screen.getByText(/Team 1 ist dran/)).toBeInTheDocument());

    // Select easy, reveal, judge correct
    await user.click(screen.getByText('3 Punkte (Leicht)'));
    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div);
    document.body.removeChild(div);
    await waitFor(() => expect(screen.getByText(/Richtig/)).toBeInTheDocument());
    await user.click(screen.getByText(/Richtig/));

    // Now Team 2's turn
    await waitFor(() => {
      expect(screen.getByText(/Team 2 ist dran/)).toBeInTheDocument();
    });
  });

  it('shows points value in question header', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Quiz Chase')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByText('7 Punkte (Schwer)')).toBeInTheDocument());
    await user.click(screen.getByText('7 Punkte (Schwer)'));

    await waitFor(() => {
      expect(screen.getByText(/7 Punkte/)).toBeInTheDocument();
    });
  });
});
