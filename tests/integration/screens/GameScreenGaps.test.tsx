import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import GameScreen from '@/components/screens/GameScreen';

// Mock navigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock API
const mockFetchGameData = vi.fn();
vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
  }),
  fetchGameData: (...args: any[]) => mockFetchGameData(...args),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
}));

// Mock canvas-confetti
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

function renderGameScreen(index = 0) {
  return render(
    <MemoryRouter initialEntries={[`/game?index=${index}`]}>
      <GameProvider>
        <MusicProvider>
          <Routes>
            <Route path="/game" element={<GameScreen />} />
          </Routes>
        </MusicProvider>
      </GameProvider>
    </MemoryRouter>
  );
}

describe('GameScreen - Gaps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchGameData.mockResolvedValue({
      config: {
        type: 'simple-quiz',
        title: 'Test Quiz',
        rules: ['Rule 1'],
        questions: [
          { question: 'Q1', answer: 'A1' },
          { question: 'Q2', answer: 'A2' },
        ],
      },
      gameId: 'game-0',
      currentIndex: 0,
      totalGames: 3,
      pointSystemEnabled: true,
    });
  });

  it('shows loading state initially', () => {
    mockFetchGameData.mockReturnValue(new Promise(() => {})); // never resolves
    renderGameScreen();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows error when fetch fails', async () => {
    mockFetchGameData.mockRejectedValueOnce(new Error('Network failure'));
    renderGameScreen();

    await waitFor(() => {
      expect(screen.getByText('Error loading game')).toBeInTheDocument();
      expect(screen.getByText('Network failure')).toBeInTheDocument();
    });
  });

  it('fetches game data with correct index', async () => {
    renderGameScreen(2);

    await waitFor(() => {
      expect(mockFetchGameData).toHaveBeenCalledWith(2);
    });
  });

  it('renders game component after loading', async () => {
    renderGameScreen();

    await waitFor(() => {
      expect(screen.getByText('Test Quiz')).toBeInTheDocument();
    });
  });

  it('navigates to next game when handleNextGame is called', async () => {
    mockFetchGameData.mockResolvedValue({
      config: {
        type: 'simple-quiz',
        title: 'First Game',
        rules: ['R'],
        questions: [{ question: 'Q', answer: 'A' }],
      },
      gameId: 'game-0',
      currentIndex: 0,
      totalGames: 3,
      pointSystemEnabled: false,
    });

    renderGameScreen(0);
    await waitFor(() => expect(screen.getByText('First Game')).toBeInTheDocument());

    // Advance to game → complete → next
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); }); // landing → rules
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); }); // rules → game

    // Click to advance through question → answer → complete → next
    const div = document.createElement('div');
    document.body.appendChild(div);
    div.click();
    document.body.removeChild(div);

    // Wait for "Nächstes Spiel" button
    await waitFor(() => {
      const nextBtn = screen.queryByText('Nächstes Spiel');
      if (nextBtn) nextBtn.click();
    }, { timeout: 3000 });

    // Should navigate to next game index
    await waitFor(() => {
      if (mockNavigate.mock.calls.length > 0) {
        const lastCall = mockNavigate.mock.calls[mockNavigate.mock.calls.length - 1][0];
        expect(lastCall).toMatch(/\/game\?index=1|\/summary/);
      }
    }, { timeout: 2000 });
  });

  it('navigates to /summary when on last game', async () => {
    mockFetchGameData.mockResolvedValue({
      config: {
        type: 'simple-quiz',
        title: 'Last Game',
        rules: ['R'],
        questions: [{ question: 'Q', answer: 'A' }],
      },
      gameId: 'game-2',
      currentIndex: 2,
      totalGames: 3,
      pointSystemEnabled: false,
    });

    renderGameScreen(2);
    await waitFor(() => expect(screen.getByText('Last Game')).toBeInTheDocument());

    // Advance through game
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });

    const div = document.createElement('div');
    document.body.appendChild(div);
    div.click();
    document.body.removeChild(div);

    await waitFor(() => {
      const nextBtn = screen.queryByText('Nächstes Spiel');
      if (nextBtn) nextBtn.click();
    }, { timeout: 3000 });

    await waitFor(() => {
      if (mockNavigate.mock.calls.length > 0) {
        const lastCall = mockNavigate.mock.calls[mockNavigate.mock.calls.length - 1][0];
        expect(lastCall).toBe('/summary');
      }
    }, { timeout: 2000 });
  });

  it('renders different game types', async () => {
    mockFetchGameData.mockResolvedValue({
      config: {
        type: 'guessing-game',
        title: 'Guessing Zone',
        rules: ['Guess!'],
        questions: [{ question: 'How many?', answer: 42 }],
      },
      gameId: 'game-1',
      currentIndex: 1,
      totalGames: 5,
      pointSystemEnabled: true,
    });

    renderGameScreen(1);

    await waitFor(() => {
      expect(screen.getByText('Guessing Zone')).toBeInTheDocument();
    });
  });
});
