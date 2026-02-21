import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
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
      { question: 'Example Guess', answer: 50, unit: 'kg' },
      { question: 'How many?', answer: 100, unit: 'pcs' },
      { question: 'How much?', answer: 200, unit: 'km' },
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

describe('GuessingGame', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders landing screen with title', async () => {
    renderGame();
    await waitFor(() => {
      expect(screen.getByText('Test Guessing')).toBeInTheDocument();
    });
  });

  it('shows the question and guess form', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      expect(screen.getByText('Example Guess')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Tipp Team 1:')).toBeInTheDocument();
    expect(screen.getByLabelText('Tipp Team 2:')).toBeInTheDocument();
    expect(screen.getByText('Tipp Abgeben')).toBeInTheDocument();
  });

  it('shows results after submitting guesses', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByLabelText('Tipp Team 1:')).toBeInTheDocument());

    await user.type(screen.getByLabelText('Tipp Team 1:'), '40');
    await user.type(screen.getByLabelText('Tipp Team 2:'), '70');
    await user.click(screen.getByText('Tipp Abgeben'));

    // Should show the answer
    await waitFor(() => {
      expect(screen.getByText('50')).toBeInTheDocument();
    });
  });

  it('determines Team 1 as winner when closer', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByLabelText('Tipp Team 1:')).toBeInTheDocument());

    // Answer is 50, Team 1 guesses 48 (diff=2), Team 2 guesses 60 (diff=10)
    await user.type(screen.getByLabelText('Tipp Team 1:'), '48');
    await user.type(screen.getByLabelText('Tipp Team 2:'), '60');
    await user.click(screen.getByText('Tipp Abgeben'));

    await waitFor(() => {
      expect(screen.getByText('Team 1 ist näher dran!')).toBeInTheDocument();
    });
  });

  it('determines Team 2 as winner when closer', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByLabelText('Tipp Team 1:')).toBeInTheDocument());

    // Answer is 50, Team 1 guesses 10 (diff=40), Team 2 guesses 49 (diff=1)
    await user.type(screen.getByLabelText('Tipp Team 1:'), '10');
    await user.type(screen.getByLabelText('Tipp Team 2:'), '49');
    await user.click(screen.getByText('Tipp Abgeben'));

    await waitFor(() => {
      expect(screen.getByText('Team 2 ist näher dran!')).toBeInTheDocument();
    });
  });

  it('shows tie when equal distance', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByLabelText('Tipp Team 1:')).toBeInTheDocument());

    // Answer is 50, both guess 5 away
    await user.type(screen.getByLabelText('Tipp Team 1:'), '45');
    await user.type(screen.getByLabelText('Tipp Team 2:'), '55');
    await user.click(screen.getByText('Tipp Abgeben'));

    await waitFor(() => {
      expect(screen.getByText('Gleichstand!')).toBeInTheDocument();
    });
  });

  it('shows Nächste Frage button in result phase', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByLabelText('Tipp Team 1:')).toBeInTheDocument());

    await user.type(screen.getByLabelText('Tipp Team 1:'), '40');
    await user.type(screen.getByLabelText('Tipp Team 2:'), '60');
    await user.click(screen.getByText('Tipp Abgeben'));

    await waitFor(() => {
      expect(screen.getByText('Nächste Frage')).toBeInTheDocument();
    });
  });

  it('shows answer image in result phase when provided', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: 'Q', answer: 50, unit: '', answerImage: '/images/result.jpg' },
        { question: 'Q2', answer: 100, unit: '' },
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByLabelText('Tipp Team 1:')).toBeInTheDocument());

    await user.type(screen.getByLabelText('Tipp Team 1:'), '40');
    await user.type(screen.getByLabelText('Tipp Team 2:'), '60');
    await user.click(screen.getByText('Tipp Abgeben'));

    await waitFor(() => {
      const img = document.querySelector('.quiz-image') as HTMLImageElement;
      expect(img).toBeInTheDocument();
      expect(img.src).toContain('/images/result.jpg');
    });
  });

  it('displays formatted numbers with dot separator', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: 'Big number', answer: 1000000, unit: '' },
        { question: 'Q2', answer: 100, unit: '' },
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByLabelText('Tipp Team 1:')).toBeInTheDocument());

    await user.type(screen.getByLabelText('Tipp Team 1:'), '999999');
    await user.type(screen.getByLabelText('Tipp Team 2:'), '1000001');
    await user.click(screen.getByText('Tipp Abgeben'));

    // The answer (1000000) should be formatted as "1.000.000"
    await waitFor(() => {
      expect(screen.getByText('1.000.000')).toBeInTheDocument();
    });
  });
});
