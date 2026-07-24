import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GameProvider } from '@/context/GameContext';
import Header from '@/components/layout/Header';

afterEach(() => localStorage.clear());

// Mock the API
vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    teamMirrorEnabled: true,
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
    // The team name and the score (": N Punkte") render in separate spans so
    // the name can truncate independently; assert each part.
    await vi.waitFor(() => {
      expect(screen.getByText('Team 1')).toBeInTheDocument();
      expect(screen.getByText('Team 2')).toBeInTheDocument();
    });
    expect(screen.getAllByText(/Punkte/)).toHaveLength(2);
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

  it('renders team 1 in the left cell by default', async () => {
    renderHeader();
    await vi.waitFor(() => expect(screen.getByText('Team 1')).toBeInTheDocument());
    expect(document.querySelector('.team-header-left')?.textContent).toContain('Team 1');
    expect(document.querySelector('.team-header-right')?.textContent).toContain('Team 2');
  });

  it('swaps which team is in the left cell when orderSwapped is set', async () => {
    localStorage.setItem('teamOrderSwapped', 'true');
    renderHeader();
    // Order depends on teamMirrorEnabled, which loads async from /api/settings —
    // wait on the swapped layout itself, not just team-name presence (that part
    // is available synchronously from localStorage regardless of settings).
    await vi.waitFor(() => {
      expect(document.querySelector('.team-header-left')?.textContent).toContain('Team 2');
      expect(document.querySelector('.team-header-right')?.textContent).toContain('Team 1');
    });
  });

  it('ignores orderSwapped when teamMirrorEnabled is off (opt-in feature, default off)', async () => {
    const api = await import('@/services/api');
    (api.fetchSettings as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      teamMirrorEnabled: false,
      globalRules: [],
    });
    localStorage.setItem('teamOrderSwapped', 'true');
    renderHeader();
    await vi.waitFor(() => expect(screen.getByText('Team 1')).toBeInTheDocument());
    // Feature disabled → natural order regardless of the swap flag.
    expect(document.querySelector('.team-header-left')?.textContent).toContain('Team 1');
    expect(document.querySelector('.team-header-right')?.textContent).toContain('Team 2');
  });
});
