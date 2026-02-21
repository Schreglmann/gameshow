import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GameProvider } from '@/context/GameContext';
import Header from '@/components/layout/Header';

// Mock the API
vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
  }),
}));

function renderHeader(props: { showGameNumber?: boolean } = {}) {
  return render(
    <GameProvider>
      <Header {...props} />
    </GameProvider>
  );
}

describe('Header', () => {
  it('renders team points when point system is enabled', async () => {
    renderHeader();
    // Wait for settings to load
    await vi.waitFor(() => {
      expect(screen.getByText(/Team 1:/)).toBeInTheDocument();
      expect(screen.getByText(/Team 2:/)).toBeInTheDocument();
    });
  });

  it('renders with default showGameNumber=true', () => {
    renderHeader();
    // When there's no current game, game number div won't show numbers
    const header = document.querySelector('header');
    expect(header).toBeInTheDocument();
  });

  it('does not show game number when showGameNumber=false', () => {
    renderHeader({ showGameNumber: false });
    expect(screen.queryByText(/Spiel/)).not.toBeInTheDocument();
  });
});
