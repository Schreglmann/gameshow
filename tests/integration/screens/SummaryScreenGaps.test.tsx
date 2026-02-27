import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import SummaryScreen from '@/components/screens/SummaryScreen';

// Mock canvas-confetti
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
  }),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
}));

import { fetchSettings } from '@/services/api';

function renderSummary() {
  return render(
    <BrowserRouter>
      <GameProvider>
        <SummaryScreen />
      </GameProvider>
    </BrowserRouter>
  );
}

describe('SummaryScreen - Gaps', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('shows "Das Spiel ist zu Ende!" when pointSystemEnabled is false', async () => {
    vi.mocked(fetchSettings).mockResolvedValue({
      pointSystemEnabled: false,
      teamRandomizationEnabled: true,
      globalRules: [],
    });

    renderSummary();

    await waitFor(() => {
      expect(screen.getByText('Das Spiel ist zu Ende!')).toBeInTheDocument();
    });
  });

  it('shows "Vielen Dank fürs Spielen!" subtitle when pointSystemEnabled is false', async () => {
    vi.mocked(fetchSettings).mockResolvedValue({
      pointSystemEnabled: false,
      teamRandomizationEnabled: true,
      globalRules: [],
    });

    renderSummary();

    await waitFor(() => {
      expect(screen.getByText('Vielen Dank fürs Spielen!')).toBeInTheDocument();
    });
  });

  it('shows team1 wins with capitalized member names', async () => {
    vi.mocked(fetchSettings).mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      globalRules: [],
    });
    localStorage.setItem('team1', JSON.stringify(['alice', 'bob']));
    localStorage.setItem('team2', JSON.stringify(['charlie']));
    localStorage.setItem('team1Points', '20');
    localStorage.setItem('team2Points', '10');

    renderSummary();

    await waitFor(() => {
      expect(screen.getByText(/Team 1 hat gewonnen/)).toBeInTheDocument();
    });

    // Capitalized names should appear
    await waitFor(() => {
      expect(screen.getByText(/Alice/)).toBeInTheDocument();
      expect(screen.getByText(/Bob/)).toBeInTheDocument();
    });
  });

  it('shows team2 wins when team2 has more points', async () => {
    vi.mocked(fetchSettings).mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      globalRules: [],
    });
    localStorage.setItem('team1', JSON.stringify(['alice']));
    localStorage.setItem('team2', JSON.stringify(['charlie', 'dave']));
    localStorage.setItem('team1Points', '5');
    localStorage.setItem('team2Points', '15');

    renderSummary();

    await waitFor(() => {
      expect(screen.getByText(/Team 2 hat gewonnen/)).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText(/Charlie/)).toBeInTheDocument();
      expect(screen.getByText(/Dave/)).toBeInTheDocument();
    });
  });

  it('shows tie message when points are equal', async () => {
    vi.mocked(fetchSettings).mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      globalRules: [],
    });
    localStorage.setItem('team1Points', '10');
    localStorage.setItem('team2Points', '10');

    renderSummary();

    await waitFor(() => {
      expect(screen.getByText(/Unentschieden/)).toBeInTheDocument();
    });
  });

  it('shows member names for winning team', async () => {
    vi.mocked(fetchSettings).mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      globalRules: [],
    });
    localStorage.setItem('team1Points', '42');
    localStorage.setItem('team2Points', '37');
    localStorage.setItem('team1', JSON.stringify(['alice', 'bob']));

    renderSummary();

    await waitFor(() => {
      expect(screen.getByText(/Team 1 hat gewonnen/)).toBeInTheDocument();
      // Capitalized member names
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });
  });
});
