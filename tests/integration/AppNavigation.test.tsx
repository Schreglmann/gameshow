import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import HomeScreen from '@/components/screens/HomeScreen';
import GlobalRulesScreen from '@/components/screens/GlobalRulesScreen';
import GameScreen from '@/components/screens/GameScreen';
import SummaryScreen from '@/components/screens/SummaryScreen';

// Mock canvas-confetti
vi.mock('canvas-confetti', () => ({
  default: vi.fn(),
}));

const mockFetchGameData = vi.fn();

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: ['Test rule 1', 'Test rule 2'],
  }),
  fetchGameData: (...args: unknown[]) => mockFetchGameData(...args),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
}));

function renderApp(initialEntries = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <GameProvider>
        <MusicProvider>
          <Routes>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/rules" element={<GlobalRulesScreen />} />
            <Route path="/game" element={<GameScreen />} />
            <Route path="/summary" element={<SummaryScreen />} />
          </Routes>
        </MusicProvider>
      </GameProvider>
    </MemoryRouter>
  );
}

describe('App Navigation Integration', () => {
  beforeEach(() => {
    localStorage.clear();
    mockFetchGameData.mockClear();
  });

  it('renders home screen at /', () => {
    renderApp();
    expect(screen.getByText('Game Show')).toBeInTheDocument();
  });

  it('renders rules screen at /rules', async () => {
    renderApp(['/rules']);
    await waitFor(() => {
      expect(screen.getByText('Regelwerk')).toBeInTheDocument();
      expect(screen.getByText('Test rule 1')).toBeInTheDocument();
    });
  });

  it('renders game screen at /game?index=0', async () => {
    mockFetchGameData.mockResolvedValue({
      gameId: 'game1',
      config: {
        type: 'simple-quiz',
        title: 'Quiz 1',
        questions: [{ question: 'Q', answer: 'A' }],
      },
      currentIndex: 0,
      totalGames: 1,
      pointSystemEnabled: true,
    });

    renderApp(['/game?index=0']);

    await waitFor(() => {
      expect(screen.getByText('Quiz 1')).toBeInTheDocument();
    });
  });

  it('renders summary screen at /summary', async () => {
    renderApp(['/summary']);
    await waitFor(() => {
      expect(screen.getByText('Es ist ein Unentschieden!')).toBeInTheDocument();
    });
  });

  it('full flow: home -> assign teams -> navigate to rules', async () => {
    const user = userEvent.setup();
    renderApp();

    // Enter team names
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Name 1, Name 2, ...')).toBeInTheDocument();
    });

    await user.type(
      screen.getByPlaceholderText('Name 1, Name 2, ...'),
      'Alice, Bob'
    );
    await user.click(screen.getByText('Teams zuweisen'));

    // Should show teams and "Weiter" button
    await waitFor(() => {
      expect(screen.getByText('Weiter')).toBeInTheDocument();
    });

    // Navigate to rules
    await user.click(screen.getByText('Weiter'));

    await waitFor(() => {
      expect(screen.getByText('Regelwerk')).toBeInTheDocument();
    });
  });
});

describe('Points persist across screens', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('summary screen reads points from localStorage', async () => {
    localStorage.setItem('team1Points', '15');
    localStorage.setItem('team2Points', '10');
    localStorage.setItem('team1', JSON.stringify(['Winner']));
    localStorage.setItem('team2', JSON.stringify(['Loser']));

    renderApp(['/summary']);

    await waitFor(() => {
      expect(screen.getByText('Team 1 hat gewonnen!')).toBeInTheDocument();
      expect(screen.getByText('Winner')).toBeInTheDocument();
    });
  });
});
