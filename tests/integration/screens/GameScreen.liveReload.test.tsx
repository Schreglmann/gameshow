import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import { ThemeProvider } from '@/context/ThemeContext';
import GameScreen from '@/components/screens/GameScreen';
import { __emitChannelForTests, __clearWsCacheForTests } from '@/services/useBackendSocket';

const mockFetchGameData = vi.fn();
const mockedNavigate = vi.fn();

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
  }),
  fetchGameData: (...args: unknown[]) => mockFetchGameData(...args),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
  fetchTheme: vi.fn().mockResolvedValue({ frontend: 'galaxia', admin: 'galaxia' }),
  saveTheme: vi.fn().mockResolvedValue({ frontend: 'galaxia', admin: 'galaxia' }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockedNavigate };
});

function gameData(title: string, questions: { question: string; answer: string }[]) {
  return {
    gameId: 'game1',
    config: { type: 'simple-quiz', title, rules: ['Rule'], questions },
    currentIndex: 0,
    totalGames: 3,
    pointSystemEnabled: true,
  };
}

function renderGameScreen() {
  return render(
    <MemoryRouter initialEntries={['/game?index=0']}>
      <ThemeProvider>
        <GameProvider>
          <MusicProvider>
            <GameScreen />
          </MusicProvider>
        </GameProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('GameScreen — live content reload', () => {
  beforeEach(() => {
    localStorage.clear();
    __clearWsCacheForTests();
    mockedNavigate.mockClear();
    mockFetchGameData.mockReset();
  });

  it('re-fetches the current game on content-changed { games } WITHOUT blanking, and shows the edit', async () => {
    const original = gameData('Original Quiz', [{ question: 'Example Q', answer: 'Example A' }, { question: 'Q1', answer: 'A1' }]);
    mockFetchGameData.mockResolvedValue(original);
    renderGameScreen();
    await waitFor(() => expect(screen.getByText('Original Quiz')).toBeInTheDocument());
    expect(mockFetchGameData).toHaveBeenCalledTimes(1);

    // Make the refresh fetch hang so we can observe the in-flight state.
    let resolveRefresh!: (v: unknown) => void;
    const refreshPromise = new Promise<unknown>(res => { resolveRefresh = res; });
    mockFetchGameData.mockReturnValueOnce(refreshPromise);

    act(() => {
      __emitChannelForTests('content-changed', { games: true });
    });

    // While the refresh is in flight: no "Loading…" blank, the previous game
    // stays mounted (proves we did NOT setGameData(null)).
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(screen.getByText('Original Quiz')).toBeInTheDocument();
    expect(mockFetchGameData).toHaveBeenCalledTimes(2);
    expect(mockFetchGameData).toHaveBeenLastCalledWith(0);

    // Now the edited game arrives and swaps in place.
    await act(async () => {
      resolveRefresh(gameData('Fixed Quiz', [{ question: 'Example Q', answer: 'Example A' }, { question: 'Q1', answer: 'A1' }]));
      await refreshPromise;
    });
    await waitFor(() => expect(screen.getByText('Fixed Quiz')).toBeInTheDocument());
  });

  it('re-fetches the current game on content-changed { config } too', async () => {
    mockFetchGameData.mockResolvedValue(gameData('Quiz', [{ question: 'Q', answer: 'A' }]));
    renderGameScreen();
    await waitFor(() => expect(screen.getByText('Quiz')).toBeInTheDocument());
    expect(mockFetchGameData).toHaveBeenCalledTimes(1);

    await act(async () => {
      __emitChannelForTests('content-changed', { config: true });
    });
    await waitFor(() => expect(mockFetchGameData).toHaveBeenCalledTimes(2));
  });

  it('does NOT re-fetch the game for a theme-only content-changed', async () => {
    mockFetchGameData.mockResolvedValue(gameData('Quiz', [{ question: 'Q', answer: 'A' }]));
    renderGameScreen();
    await waitFor(() => expect(screen.getByText('Quiz')).toBeInTheDocument());
    expect(mockFetchGameData).toHaveBeenCalledTimes(1);

    await act(async () => {
      __emitChannelForTests('content-changed', { theme: true });
    });
    expect(mockFetchGameData).toHaveBeenCalledTimes(1);
  });

  it('jumps to the title screen of the next game when the current game is deleted', async () => {
    // Game A is playing and advanced past its title screen.
    mockFetchGameData.mockResolvedValue({
      gameId: 'gameA',
      config: { type: 'simple-quiz', title: 'Game A', rules: ['R'], questions: [{ question: 'Ex', answer: 'A' }, { question: 'Q1', answer: 'A1' }] },
      currentIndex: 0,
      totalGames: 2,
      pointSystemEnabled: true,
    });
    renderGameScreen();
    await waitFor(() => expect(screen.getByText('Game A')).toBeInTheDocument());
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))); // landing → rules
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))); // rules → game
    await waitFor(() => expect(screen.queryByText('Game A')).not.toBeInTheDocument());

    // Admin deletes the current game: the next game (gameB) shifts into index 0.
    mockFetchGameData.mockResolvedValue({
      gameId: 'gameB',
      config: { type: 'simple-quiz', title: 'Game B', rules: ['R'], questions: [{ question: 'Ex', answer: 'A' }, { question: 'Q1', answer: 'A1' }] },
      currentIndex: 0,
      totalGames: 1,
      pointSystemEnabled: true,
    });
    await act(async () => {
      __emitChannelForTests('content-changed', { config: true });
    });

    // The next game appears AT ITS TITLE SCREEN (different gameId ⇒ remount,
    // resetting the wrapper to the landing phase).
    await waitFor(() => expect(screen.getByText('Game B')).toBeInTheDocument());
    expect(mockedNavigate).not.toHaveBeenCalledWith('/summary');
  });

  it('jumps to the summary when the deleted current game was the last (404 on live refresh)', async () => {
    mockFetchGameData.mockResolvedValue(gameData('Last Game', [{ question: 'Q', answer: 'A' }]));
    renderGameScreen();
    await waitFor(() => expect(screen.getByText('Last Game')).toBeInTheDocument());

    // Deleted last game → index 0 is now out of range → 404.
    mockFetchGameData.mockRejectedValue(Object.assign(new Error('Failed to fetch game 0'), { status: 404 }));
    await act(async () => {
      __emitChannelForTests('content-changed', { config: true });
    });
    await waitFor(() => expect(mockedNavigate).toHaveBeenCalledWith('/summary'));
  });

  it('keeps the running game on a transient (non-404) live-refresh error', async () => {
    mockFetchGameData.mockResolvedValue(gameData('Stable Game', [{ question: 'Q', answer: 'A' }]));
    renderGameScreen();
    await waitFor(() => expect(screen.getByText('Stable Game')).toBeInTheDocument());

    mockFetchGameData.mockRejectedValue(Object.assign(new Error('network blip'), { status: 500 }));
    await act(async () => {
      __emitChannelForTests('content-changed', { games: true });
    });

    // No summary jump, no error screen — the running game stays put.
    expect(mockedNavigate).not.toHaveBeenCalledWith('/summary');
    expect(screen.getByText('Stable Game')).toBeInTheDocument();
  });
});
