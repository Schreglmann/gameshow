import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import FinalQuiz from '@/components/games/FinalQuiz';
import type { FinalQuizConfig } from '@/types/config';

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

function makeConfig(overrides: Partial<FinalQuizConfig> = {}): FinalQuizConfig {
  return {
    type: 'final-quiz',
    title: 'Final Round',
    rules: ['Bet your points!'],
    questions: [
      { question: 'Example Q', answer: 'Example A' },
      { question: 'Final Q1', answer: 'Final A1' },
      { question: 'Final Q2', answer: 'Final A2' },
    ],
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

describe('FinalQuiz', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders landing screen with title', async () => {
    renderGame();
    await waitFor(() => {
      expect(screen.getByText('Final Round')).toBeInTheDocument();
    });
  });

  it('shows question in initial phase', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Final Round')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      expect(screen.getByText('Example Q')).toBeInTheDocument();
      expect(screen.getByText('Beispiel')).toBeInTheDocument();
    });
  });

  it('transitions to betting phase on click', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Final Round')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByText('Example Q')).toBeInTheDocument());

    // Click to go to betting phase
    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div);
    document.body.removeChild(div);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Gesetzte Punkte Team 1')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Gesetzte Punkte Team 2')).toBeInTheDocument();
      expect(screen.getByText('Antwort anzeigen')).toBeInTheDocument();
    });
  });

  it('shows answer and judging buttons after clicking Antwort anzeigen', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Final Round')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByText('Example Q')).toBeInTheDocument());

    // → betting
    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div);
    document.body.removeChild(div);

    await waitFor(() => expect(screen.getByText('Antwort anzeigen')).toBeInTheDocument());

    // Enter bets, show answer
    await user.type(screen.getByPlaceholderText('Gesetzte Punkte Team 1'), '5');
    await user.type(screen.getByPlaceholderText('Gesetzte Punkte Team 2'), '3');
    await user.click(screen.getByText('Antwort anzeigen'));

    await waitFor(() => {
      expect(screen.getByText('Example A')).toBeInTheDocument();
      // Judging buttons for both teams
      const richtigButtons = screen.getAllByText('Richtig');
      const falschButtons = screen.getAllByText('Falsch');
      expect(richtigButtons).toHaveLength(2);
      expect(falschButtons).toHaveLength(2);
    });
  });

  it('Nächste Frage button is disabled until both teams judged', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Final Round')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByText('Example Q')).toBeInTheDocument());

    // → betting
    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div);
    document.body.removeChild(div);

    await waitFor(() => expect(screen.getByText('Antwort anzeigen')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('Gesetzte Punkte Team 1'), '5');
    await user.type(screen.getByPlaceholderText('Gesetzte Punkte Team 2'), '3');
    await user.click(screen.getByText('Antwort anzeigen'));

    // Wait for judging phase (after 100ms setTimeout)
    let nextButton: HTMLElement;
    await waitFor(() => {
      nextButton = screen.getByText('Nächste Frage');
    });

    // "Nächste Frage" should be disabled initially
    expect(nextButton!).toBeInTheDocument();
    expect(nextButton).toBeDisabled();

    // Judge Team 1 only
    const richtigButtons = screen.getAllByText('Richtig');
    await user.click(richtigButtons[0]);
    expect(nextButton).toBeDisabled();

    // Judge Team 2
    await user.click(richtigButtons[1]);
    expect(nextButton).not.toBeDisabled();
  });

  it('awards positive points for correct judgment on non-example questions', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Final Round')).toBeInTheDocument());
    await advanceToGame(user);

    // Skip past example question: question → betting → show answer → judge both → next
    await waitFor(() => expect(screen.getByText('Example Q')).toBeInTheDocument());

    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div); // → betting
    document.body.removeChild(div);

    await waitFor(() => expect(screen.getByText('Antwort anzeigen')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('Gesetzte Punkte Team 1'), '5');
    await user.type(screen.getByPlaceholderText('Gesetzte Punkte Team 2'), '3');
    await user.click(screen.getByText('Antwort anzeigen'));

    // Wait for judging phase (after 100ms setTimeout)
    let richtigButtons: HTMLElement[];
    await waitFor(() => {
      richtigButtons = screen.getAllByText('Richtig');
    });
    await user.click(richtigButtons![0]);
    await user.click(richtigButtons![1]);

    // Example question: points should NOT be awarded
    expect(onAwardPoints).not.toHaveBeenCalled();

    await user.click(screen.getByText('Nächste Frage'));

    // Now on real question "Final Q1"
    await waitFor(() => expect(screen.getByText('Final Q1')).toBeInTheDocument());

    const div2 = document.createElement('div');
    document.body.appendChild(div2);
    await user.click(div2); // → betting
    document.body.removeChild(div2);

    await waitFor(() => expect(screen.getByText('Antwort anzeigen')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('Gesetzte Punkte Team 1'), '10');
    await user.type(screen.getByPlaceholderText('Gesetzte Punkte Team 2'), '7');
    await user.click(screen.getByText('Antwort anzeigen'));

    await waitFor(() => expect(screen.getByText('Final A1')).toBeInTheDocument());

    // Wait for judging phase (100ms setTimeout)
    await waitFor(() => {
      richtigButtons = screen.getAllByText('Richtig');
    });
    const falschButtons = screen.getAllByText('Falsch');
    await user.click(richtigButtons[0]); // Team 1 correct
    await user.click(falschButtons[1]); // Team 2 incorrect

    expect(onAwardPoints).toHaveBeenCalledWith('team1', 10);
    expect(onAwardPoints).toHaveBeenCalledWith('team2', -7);
  });

  it('reverses points when changing judgment', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: 'Q1', answer: 'A1' }, // non-example (only 1 question = index 0 is example)
        { question: 'Q2', answer: 'A2' },
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Final Round')).toBeInTheDocument());
    await advanceToGame(user);

    // Skip example
    await waitFor(() => expect(screen.getByText('Q1')).toBeInTheDocument());
    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div);
    document.body.removeChild(div);

    await waitFor(() => expect(screen.getByText('Antwort anzeigen')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('Gesetzte Punkte Team 1'), '5');
    await user.type(screen.getByPlaceholderText('Gesetzte Punkte Team 2'), '3');
    await user.click(screen.getByText('Antwort anzeigen'));
    await waitFor(() => expect(screen.queryAllByText('Richtig').length).toBeGreaterThan(0));

    // Judge Team 1 richtig, Team 2 richtig (no example, so points apply)
    // Example question (index 0) → no points
    // This is example so no points awarded
  });

  it('shows answerImage when provided', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: 'Q', answer: 'A', answerImage: '/images/final.jpg' },
        { question: 'Q2', answer: 'A2' },
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Final Round')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByText('Q')).toBeInTheDocument());

    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div);
    document.body.removeChild(div);

    await waitFor(() => expect(screen.getByText('Antwort anzeigen')).toBeInTheDocument());
    await user.click(screen.getByText('Antwort anzeigen'));

    await waitFor(() => {
      const img = document.querySelector('.quiz-image') as HTMLImageElement;
      expect(img).toBeInTheDocument();
      expect(img.src).toContain('/images/final.jpg');
    });
  });
});
