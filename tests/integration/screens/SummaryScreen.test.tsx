import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import SummaryScreen from '@/components/screens/SummaryScreen';

// Mock canvas-confetti. The real default export is a callable that also carries
// a `.reset()` used by SummaryScreen's unmount cleanup, so the mock needs both.
vi.mock('canvas-confetti', () => {
  const confetti = Object.assign(vi.fn(), { reset: vi.fn() });
  return { default: confetti };
});

const mockedNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockedNavigate };
});

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
    mockedNavigate.mockClear();
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

  it('lays a large winning roster out in a balanced grid', async () => {
    // Nine names used to be nine stacked paragraphs, which grew the card past
    // the viewport — see specs/team-management.md.
    localStorage.setItem('team1Points', '10');
    localStorage.setItem('team2Points', '5');
    localStorage.setItem('team1', JSON.stringify([
      'anna', 'bernd', 'christina', 'dominik', 'elena', 'franz', 'gabriele', 'hannes', 'isabella',
    ]));
    localStorage.setItem('team2', JSON.stringify(['jonas']));

    renderSummaryScreen();

    await waitFor(() => expect(screen.getByText('Team 1 hat gewonnen!')).toBeInTheDocument());
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(9);
    expect(items[0]).toHaveTextContent('Anna');
    expect(items[8]).toHaveTextContent('Isabella');
    expect(items[0].closest('ul')).toHaveAttribute('data-columns', '3');
    // Each name has its own entrance delay instead of the four nth-child rules.
    expect(items[0]).toHaveStyle({ animationDelay: '0.3s' });
    expect(items[8]).toHaveStyle({ animationDelay: '0.94s' });
  });

  it('keeps a small roster in a single column', async () => {
    localStorage.setItem('team1Points', '3');
    localStorage.setItem('team2Points', '8');
    localStorage.setItem('team2', JSON.stringify(['bob', 'dave']));

    renderSummaryScreen();

    await waitFor(() => expect(screen.getByText('Team 2 hat gewonnen!')).toBeInTheDocument());
    expect(screen.getAllByRole('listitem')[0].closest('ul')).toHaveAttribute('data-columns', '1');
  });

  it('shows zero-points draw at start', async () => {
    renderSummaryScreen();
    await waitFor(() => {
      expect(screen.getByText('Es ist ein Unentschieden!')).toBeInTheDocument();
    });
  });

  it('goes back to the last game (resumed at its end) on ArrowLeft', async () => {
    // The last game index is totalGames - 1.
    localStorage.setItem('currentGame', JSON.stringify({ currentIndex: 2, totalGames: 3 }));
    renderSummaryScreen();
    await waitFor(() => expect(screen.getByText('Es ist ein Unentschieden!')).toBeInTheDocument());

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); });
    expect(mockedNavigate).toHaveBeenCalledWith('/game?index=2', { state: { resumeAtEnd: true } });
  });

  it('does not navigate back when there are no games', async () => {
    // No currentGame in storage → totalGames unknown → nothing to go back to.
    renderSummaryScreen();
    await waitFor(() => expect(screen.getByText('Es ist ein Unentschieden!')).toBeInTheDocument());

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); });
    expect(mockedNavigate).not.toHaveBeenCalled();
  });
});
