import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { ThemeProvider } from '@/context/ThemeContext';
import GameScreen from '@/components/screens/GameScreen';
import { fetchGameData } from '@/services/api';
import { __emitChannelForTests } from '@/services/useBackendSocket';

// The running game re-fetches on `content-changed` — including `filmStripes`, sent when
// a film stripe finishes computing, so the stripe appears without a reload.
// See specs/live-config-reload.md and specs/games/film-stripe.md.

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({ pointSystemEnabled: true, teamRandomizationEnabled: true, globalRules: [] }),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
  fetchTheme: vi.fn().mockResolvedValue({ frontend: 'galaxia', admin: 'galaxia' }),
  saveTheme: vi.fn().mockResolvedValue(undefined),
  fetchGameData: vi.fn((index: number) => Promise.resolve({
    gameId: 'filmstreifen/v1',
    currentIndex: index,
    totalGames: 10,
    pointSystemEnabled: true,
    config: { type: 'film-stripe', title: 'Filmstreifen', rules: [], questions: [] },
  })),
}));

vi.mock('@/components/games/GameFactory', () => ({
  default: () => <div>Spiel</div>,
}));

function renderGame() {
  return render(
    <MemoryRouter initialEntries={['/game?index=2']}>
      <ThemeProvider>
        <GameProvider>
          <Routes>
            <Route path="/game" element={<GameScreen />} />
          </Routes>
        </GameProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe('GameScreen live reload', () => {
  beforeEach(() => {
    vi.mocked(fetchGameData).mockClear();
  });

  it('re-fetches the current game when a film stripe finished computing', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Spiel')).toBeInTheDocument());
    const before = vi.mocked(fetchGameData).mock.calls.length;

    await act(async () => { __emitChannelForTests('content-changed', { filmStripes: true }); });

    await waitFor(() => expect(vi.mocked(fetchGameData).mock.calls.length).toBe(before + 1));
    expect(vi.mocked(fetchGameData)).toHaveBeenLastCalledWith(2);
  });

  it('does not re-fetch the game for a theme-only change', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Spiel')).toBeInTheDocument());
    const before = vi.mocked(fetchGameData).mock.calls.length;

    await act(async () => { __emitChannelForTests('content-changed', { theme: true }); });

    expect(vi.mocked(fetchGameData).mock.calls.length).toBe(before);
  });
});
