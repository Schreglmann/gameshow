import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import GamesTab from '@/components/backend/GamesTab';
import { GameProvider } from '@/context/GameContext';
import type { GameFileSummary } from '@/types/config';
import { __emitChannelForTests, __clearWsCacheForTests } from '@/services/useBackendSocket';

const mockFetchGames = vi.fn();
const mockFetchGame = vi.fn();

vi.mock('@/services/backendApi', () => ({
  fetchGames: (...args: unknown[]) => mockFetchGames(...args),
  fetchGame: (...args: unknown[]) => mockFetchGame(...args),
  createGame: vi.fn().mockResolvedValue(undefined),
  createExampleGames: vi.fn().mockResolvedValue({ createdGames: [], gameshow: 'x' }),
  deleteGame: vi.fn().mockResolvedValue({ success: true, removedRefs: [] }),
  saveGame: vi.fn().mockResolvedValue(undefined),
  fetchConfig: vi.fn().mockResolvedValue({ activeGameshow: 'test', gameshows: {} }),
}));

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
    isCleanInstall: false,
  }),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
}));

const initialGames: GameFileSummary[] = [
  { fileName: 'quiz-1', type: 'simple-quiz', title: 'Quiz 1', instances: ['v1'], isSingleInstance: false },
];

function renderGamesTab() {
  return render(
    <GameProvider>
      <GamesTab onGoToAssets={vi.fn()} onNavigate={vi.fn()} />
    </GameProvider>
  );
}

describe('GamesTab — cross-tab live sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    __clearWsCacheForTests();
    mockFetchGames.mockResolvedValue(initialGames);
    mockFetchGame.mockResolvedValue({ type: 'simple-quiz', title: 'Quiz 1', rules: [], instances: { v1: { questions: [] } } });
  });

  it('refreshes the game list when content-changed { games } arrives', async () => {
    renderGamesTab();
    await waitFor(() => expect(screen.getByText('Quiz 1')).toBeInTheDocument());
    const callsAfterMount = mockFetchGames.mock.calls.length;

    // Another admin instance added a game.
    mockFetchGames.mockResolvedValue([
      ...initialGames,
      { fileName: 'new-game', type: 'audio-guess', title: 'Neues Spiel', instances: [], isSingleInstance: true },
    ]);
    await act(async () => {
      __emitChannelForTests('content-changed', { games: true });
    });

    await waitFor(() => expect(screen.getByText('Neues Spiel')).toBeInTheDocument());
    expect(mockFetchGames.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it('does NOT refresh the list for a content-changed without the games flag', async () => {
    renderGamesTab();
    await waitFor(() => expect(screen.getByText('Quiz 1')).toBeInTheDocument());
    const callsAfterMount = mockFetchGames.mock.calls.length;

    await act(async () => {
      __emitChannelForTests('content-changed', { config: true, theme: true });
    });
    expect(mockFetchGames.mock.calls.length).toBe(callsAfterMount);
  });
});
