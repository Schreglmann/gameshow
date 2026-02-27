import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import GameScreen from '@/components/screens/GameScreen';

const mockFetchGameData = vi.fn();
const mockedNavigate = vi.fn();

// Mock modules
vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
  }),
  fetchGameData: (...args: unknown[]) => mockFetchGameData(...args),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockedNavigate,
  };
});

function renderGameScreen(initialEntries = ['/game?index=0']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <GameProvider>
        <MusicProvider>
          <GameScreen />
        </MusicProvider>
      </GameProvider>
    </MemoryRouter>
  );
}

describe('GameScreen', () => {
  beforeEach(() => {
    mockedNavigate.mockClear();
    mockFetchGameData.mockClear();
  });

  it('shows loading state initially', () => {
    mockFetchGameData.mockReturnValue(new Promise(() => {})); // Never resolves
    renderGameScreen();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows error state when fetch fails', async () => {
    mockFetchGameData.mockRejectedValue(new Error('Server error'));
    renderGameScreen();

    await waitFor(() => {
      expect(screen.getByText('Error loading game')).toBeInTheDocument();
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
  });

  it('renders a simple-quiz game when data loads', async () => {
    mockFetchGameData.mockResolvedValue({
      gameId: 'game1',
      config: {
        type: 'simple-quiz',
        title: 'Test Quiz',
        rules: ['Test Rule'],
        questions: [
          { question: 'Example Q', answer: 'Example A' },
          { question: 'Q1', answer: 'A1' },
        ],
      },
      currentIndex: 0,
      totalGames: 3,
      pointSystemEnabled: true,
    });

    renderGameScreen();

    await waitFor(() => {
      expect(screen.getByText('Test Quiz')).toBeInTheDocument();
    });
  });

  it('renders a guessing-game type', async () => {
    mockFetchGameData.mockResolvedValue({
      gameId: 'game2',
      config: {
        type: 'guessing-game',
        title: 'Guess Game',
        rules: ['Guess close'],
        questions: [
          { question: 'Example', answer: 100 },
          { question: 'How many?', answer: 42 },
        ],
      },
      currentIndex: 1,
      totalGames: 3,
      pointSystemEnabled: true,
    });

    renderGameScreen(['/game?index=1']);

    await waitFor(() => {
      expect(screen.getByText('Guess Game')).toBeInTheDocument();
    });
  });

  it('fetches game data with the correct index from URL', async () => {
    mockFetchGameData.mockResolvedValue({
      gameId: 'game3',
      config: {
        type: 'simple-quiz',
        title: 'Quiz 3',
        questions: [{ question: 'Q', answer: 'A' }],
      },
      currentIndex: 2,
      totalGames: 5,
      pointSystemEnabled: true,
    });

    renderGameScreen(['/game?index=2']);

    await waitFor(() => {
      expect(mockFetchGameData).toHaveBeenCalledWith(2);
    });
  });

  it('renders a fact-or-fake game type', async () => {
    mockFetchGameData.mockResolvedValue({
      gameId: 'game4',
      config: {
        type: 'fact-or-fake',
        title: 'Fakt oder Fake',
        questions: [
          { statement: 'Example', answer: 'FAKT', description: 'Test' },
          { statement: 'Water is wet', answer: 'FAKT', description: 'Obviously' },
        ],
      },
      currentIndex: 0,
      totalGames: 3,
      pointSystemEnabled: true,
    });

    renderGameScreen();

    await waitFor(() => {
      expect(screen.getByText('Fakt oder Fake')).toBeInTheDocument();
    });
  });
});
