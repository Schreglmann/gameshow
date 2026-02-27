import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { GameProvider, useGameContext } from '@/context/GameContext';
import Header from '@/components/layout/Header';
import type { ReactNode } from 'react';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
  }),
}));

import { fetchSettings } from '@/services/api';

// Helper to set up game state and render header
function renderHeaderWithState(opts: {
  showGameNumber?: boolean;
  pointSystemEnabled?: boolean;
  currentGame?: { currentIndex: number; totalGames: number } | null;
  team1Points?: number;
  team2Points?: number;
} = {}) {
  const {
    showGameNumber = true,
    pointSystemEnabled = true,
    currentGame = null,
    team1Points = 0,
    team2Points = 0,
  } = opts;

  vi.mocked(fetchSettings).mockResolvedValue({
    pointSystemEnabled,
    teamRandomizationEnabled: true,
    globalRules: [],
  });

  if (team1Points) localStorage.setItem('team1Points', String(team1Points));
  if (team2Points) localStorage.setItem('team2Points', String(team2Points));

  // Use a wrapper to dispatch SET_CURRENT_GAME
  function Wrapper({ children }: { children: ReactNode }) {
    return <GameProvider>{children}</GameProvider>;
  }

  function Content() {
    const { dispatch, state } = useGameContext();
    // Set current game on mount
    if (currentGame && !state.currentGame) {
      setTimeout(() => {
        dispatch({ type: 'SET_CURRENT_GAME', payload: currentGame });
      }, 0);
    }
    return <Header showGameNumber={showGameNumber} />;
  }

  return render(
    <Wrapper>
      <Content />
    </Wrapper>
  );
}

describe('Header - Gaps', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('hides team points when pointSystemEnabled is false', async () => {
    renderHeaderWithState({ pointSystemEnabled: false });

    await vi.waitFor(() => {
      // When point system is disabled, team point containers should not be visible
      expect(screen.queryByText(/Team 1:/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Team 2:/)).not.toBeInTheDocument();
    });
  });

  it('shows game number when showGameNumber and currentGame are set', async () => {
    renderHeaderWithState({
      showGameNumber: true,
      currentGame: { currentIndex: 2, totalGames: 8 },
    });

    // Wait for settings to load + dispatch
    await vi.waitFor(() => {
      expect(screen.getByText(/Spiel/)).toBeInTheDocument();
    });

    expect(screen.getByText(/Spiel 3 von 8/)).toBeInTheDocument();
  });

  it('does not show game number when showGameNumber is true but no currentGame', async () => {
    renderHeaderWithState({ showGameNumber: true, currentGame: null });

    await vi.waitFor(() => {
      // No "Spiel X von Y" text since no current game
      expect(screen.queryByText(/Spiel \d+ von \d+/)).not.toBeInTheDocument();
    });
  });

  it('displays team points from localStorage', async () => {
    renderHeaderWithState({
      pointSystemEnabled: true,
      team1Points: 15,
      team2Points: 23,
    });

    await vi.waitFor(() => {
      expect(screen.getByText(/15/)).toBeInTheDocument();
      expect(screen.getByText(/23/)).toBeInTheDocument();
    });
  });
});
