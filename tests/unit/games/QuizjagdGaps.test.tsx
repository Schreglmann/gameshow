import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import Quizjagd from '@/components/games/Quizjagd';
import type { QuizjagdConfig, QuizjagdQuestionSet } from '@/types/config';

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

function makeStructuredConfig(overrides: Partial<QuizjagdConfig> = {}): QuizjagdConfig {
  return {
    type: 'quizjagd',
    title: 'Quiz Chase',
    rules: ['Answer questions'],
    questions: {
      easy: [
        { question: 'Easy Q1', answer: 'Easy A1' },
        { question: 'Easy Q2', answer: 'Easy A2' },
      ],
      medium: [
        { question: 'Med Q1', answer: 'Med A1' },
        { question: 'Med Q2', answer: 'Med A2' },
      ],
      hard: [
        { question: 'Hard Q1', answer: 'Hard A1' },
        { question: 'Hard Q2', answer: 'Hard A2' },
      ],
    } as QuizjagdQuestionSet,
    questionsPerTeam: 2,
    ...overrides,
  };
}

function makeFlatConfig(): QuizjagdConfig {
  return {
    type: 'quizjagd',
    title: 'Quiz Chase Flat',
    rules: ['Answer questions'],
    questions: [
      { question: 'Example Q', answer: 'Example A', difficulty: 3 },
      { question: 'Easy Q', answer: 'Easy A', difficulty: 3 },
      { question: 'Med Q', answer: 'Med A', difficulty: 5 },
      { question: 'Hard Q', answer: 'Hard A', difficulty: 7 },
    ] as any,
    questionsPerTeam: 1,
  };
}

function renderGame(config?: QuizjagdConfig) {
  // Set up teams in localStorage so the team display works
  localStorage.setItem('team1', JSON.stringify(['Alice', 'Bob']));
  localStorage.setItem('team2', JSON.stringify(['Charlie', 'Dave']));
  
  return render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <Quizjagd {...defaultProps} config={config || makeStructuredConfig()} />
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

describe('Quizjagd - Gaps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    defaultProps.onNextGame = vi.fn();
    defaultProps.onAwardPoints = vi.fn();
  });

  it('shows example question with Beispiel label', async () => {
    const user = userEvent.setup();
    const config = makeFlatConfig();
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Quiz Chase Flat')).toBeInTheDocument());
    advanceToGame();

    // Select easy difficulty for example
    await waitFor(() => expect(screen.getByText('3 Punkte (Leicht)')).toBeInTheDocument());
    await user.click(screen.getByText('3 Punkte (Leicht)'));

    await waitFor(() => {
      expect(screen.getByText(/Beispiel/)).toBeInTheDocument();
      expect(screen.getByText('Example Q')).toBeInTheDocument();
    });
  });

  it('does not award points for example questions', async () => {
    const user = userEvent.setup();
    const config = makeFlatConfig();
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Quiz Chase Flat')).toBeInTheDocument());
    advanceToGame();

    // Select difficulty for example
    await waitFor(() => expect(screen.getByText('3 Punkte (Leicht)')).toBeInTheDocument());
    await user.click(screen.getByText('3 Punkte (Leicht)'));

    // Reveal answer
    await clickForward(user);

    // Click Richtig
    await waitFor(() => expect(screen.getByText(/Richtig/)).toBeInTheDocument());
    await user.click(screen.getByText(/Richtig/));

    // No points should be awarded for example
    expect(defaultProps.onAwardPoints).not.toHaveBeenCalled();
  });

  it('awards positive points for correct answer', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Quiz Chase')).toBeInTheDocument());
    advanceToGame();

    // Example round first
    await waitFor(() => expect(screen.getByText('3 Punkte (Leicht)')).toBeInTheDocument());
    await user.click(screen.getByText('3 Punkte (Leicht)'));
    await clickForward(user);
    await waitFor(() => expect(screen.getByText(/Richtig/)).toBeInTheDocument());
    await user.click(screen.getByText(/Richtig/));

    // Real round — select easy (3 pts)
    await waitFor(() => expect(screen.getByText('3 Punkte (Leicht)')).toBeInTheDocument());
    await user.click(screen.getByText('3 Punkte (Leicht)'));
    await clickForward(user);
    await waitFor(() => expect(screen.getByText(/Richtig/)).toBeInTheDocument());
    await user.click(screen.getByText(/Richtig/));

    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team1', 3);
  });

  it('awards negative points for incorrect answer', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Quiz Chase')).toBeInTheDocument());
    advanceToGame();

    // Example round first (use easy so medium stays available)
    await waitFor(() => expect(screen.getByText('3 Punkte (Leicht)')).toBeInTheDocument());
    await user.click(screen.getByText('3 Punkte (Leicht)'));
    // Reveal answer
    await clickForward(user);
    await waitFor(() => expect(screen.getByText(/Richtig/)).toBeInTheDocument());
    await user.click(screen.getByText(/Richtig/));

    // Real round — select medium (5 pts)
    await waitFor(() => expect(screen.getByText('5 Punkte (Mittel)')).toBeInTheDocument());
    await user.click(screen.getByText('5 Punkte (Mittel)'));
    await clickForward(user);
    await waitFor(() => expect(screen.getByText(/Falsch/)).toBeInTheDocument());
    await user.click(screen.getByText(/Falsch/));

    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team1', -5);
  });

  it('alternates teams after each question', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Quiz Chase')).toBeInTheDocument());
    advanceToGame();

    // Example round first (no team switch)
    await waitFor(() => expect(screen.getByText(/Team 1/)).toBeInTheDocument());
    await user.click(screen.getByText('3 Punkte (Leicht)'));
    await clickForward(user);
    await waitFor(() => expect(screen.getByText(/Richtig/)).toBeInTheDocument());
    await user.click(screen.getByText(/Richtig/));

    // Real round: Team 1
    await waitFor(() => expect(screen.getByText(/Team 1/)).toBeInTheDocument());
    await user.click(screen.getByText('3 Punkte (Leicht)'));
    await clickForward(user);
    await waitFor(() => expect(screen.getByText(/Richtig/)).toBeInTheDocument());
    await user.click(screen.getByText(/Richtig/));

    // Now Team 2
    await waitFor(() => expect(screen.getByText(/Team 2/)).toBeInTheDocument());
  });

  it('shows difficulty buttons with 3, 5, and 7 points', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Quiz Chase')).toBeInTheDocument());
    advanceToGame();

    await waitFor(() => {
      expect(screen.getByText('3 Punkte (Leicht)')).toBeInTheDocument();
      expect(screen.getByText('5 Punkte (Mittel)')).toBeInTheDocument();
      expect(screen.getByText('7 Punkte (Schwer)')).toBeInTheDocument();
    });
  });

  it('shows points value in question header', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Quiz Chase')).toBeInTheDocument());
    advanceToGame();

    await user.click(screen.getByText('7 Punkte (Schwer)'));

    await waitFor(() => {
      expect(screen.getByText(/7 Punkte/)).toBeInTheDocument();
    });
  });
});
