import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import SummaryScreen from '@/components/screens/SummaryScreen';

// Mock canvas-confetti
vi.mock('canvas-confetti', () => ({
  default: vi.fn(),
}));

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
  }),
}));

function renderSummaryScreen() {
  return render(
    <BrowserRouter>
      <GameProvider>
        <SummaryScreen />
      </GameProvider>
    </BrowserRouter>
  );
}

describe('SummaryScreen', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows tie message when points are equal', async () => {
    localStorage.setItem('team1Points', '5');
    localStorage.setItem('team2Points', '5');
    localStorage.setItem('team1', JSON.stringify(['Alice']));
    localStorage.setItem('team2', JSON.stringify(['Bob']));

    renderSummaryScreen();

    await waitFor(() => {
      expect(screen.getByText('Es ist ein Unentschieden!')).toBeInTheDocument();
    });
  });

  it('shows Team 1 wins when team1 has more points', async () => {
    localStorage.setItem('team1Points', '10');
    localStorage.setItem('team2Points', '5');
    localStorage.setItem('team1', JSON.stringify(['Alice', 'Charlie']));
    localStorage.setItem('team2', JSON.stringify(['Bob']));

    renderSummaryScreen();

    await waitFor(() => {
      expect(screen.getByText('Team 1 hat gewonnen!')).toBeInTheDocument();
    });
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Charlie')).toBeInTheDocument();
  });

  it('shows Team 2 wins when team2 has more points', async () => {
    localStorage.setItem('team1Points', '3');
    localStorage.setItem('team2Points', '8');
    localStorage.setItem('team1', JSON.stringify(['Alice']));
    localStorage.setItem('team2', JSON.stringify(['bob', 'dave']));

    renderSummaryScreen();

    await waitFor(() => {
      expect(screen.getByText('Team 2 hat gewonnen!')).toBeInTheDocument();
    });
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Dave')).toBeInTheDocument();
  });

  it('shows zero-points draw at start', async () => {
    renderSummaryScreen();
    await waitFor(() => {
      expect(screen.getByText('Es ist ein Unentschieden!')).toBeInTheDocument();
    });
  });
});
