import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import HomeScreen from '@/components/screens/HomeScreen';

// Mock API
vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: ['Rule 1'],
  }),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
}));

// Mock useNavigate
const mockedNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockedNavigate,
  };
});

function renderHomeScreen() {
  return render(
    <BrowserRouter>
      <GameProvider>
        <MusicProvider>
          <HomeScreen />
        </MusicProvider>
      </GameProvider>
    </BrowserRouter>
  );
}

describe('HomeScreen', () => {
  beforeEach(() => {
    localStorage.clear();
    mockedNavigate.mockClear();
  });

  it('renders the Game Show heading', () => {
    renderHomeScreen();
    expect(screen.getByText('Game Show')).toBeInTheDocument();
  });

  it('shows team assignment form when team randomization is enabled', async () => {
    renderHomeScreen();
    await waitFor(() => {
      expect(
        screen.getByText('Namen eingeben, um sie den Teams zuzuweisen:')
      ).toBeInTheDocument();
    });
  });

  it('does not show "Weiter" button when no teams are assigned', async () => {
    renderHomeScreen();
    await waitFor(() => {
      expect(
        screen.getByText('Namen eingeben, um sie den Teams zuzuweisen:')
      ).toBeInTheDocument();
    });
    // Weiter should not be visible without teams
    expect(screen.queryByText('Weiter')).not.toBeInTheDocument();
  });

  it('assigns teams when names are submitted', async () => {
    const user = userEvent.setup();
    renderHomeScreen();

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Name 1, Name 2, ...')).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText('Name 1, Name 2, ...');
    await user.type(textarea, 'Alice, Bob, Charlie, Dave');
    await user.click(screen.getByText('Teams zuweisen'));

    // Teams should be displayed
    await waitFor(() => {
      expect(screen.getByText('Team 1')).toBeInTheDocument();
      expect(screen.getByText('Team 2')).toBeInTheDocument();
    });

    // All names should appear somewhere
    const allText = document.body.textContent!;
    expect(allText).toContain('Alice');
    expect(allText).toContain('Bob');
    expect(allText).toContain('Charlie');
    expect(allText).toContain('Dave');
  });

  it('shows "Weiter" button after teams are assigned', async () => {
    const user = userEvent.setup();
    renderHomeScreen();

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Name 1, Name 2, ...')).toBeInTheDocument();
    });

    await user.type(
      screen.getByPlaceholderText('Name 1, Name 2, ...'),
      'Alice, Bob'
    );
    await user.click(screen.getByText('Teams zuweisen'));

    await waitFor(() => {
      expect(screen.getByText('Weiter')).toBeInTheDocument();
    });
  });

  it('navigates to /rules when Weiter is clicked', async () => {
    const user = userEvent.setup();
    renderHomeScreen();

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Name 1, Name 2, ...')).toBeInTheDocument();
    });

    await user.type(
      screen.getByPlaceholderText('Name 1, Name 2, ...'),
      'Alice, Bob'
    );
    await user.click(screen.getByText('Teams zuweisen'));

    await waitFor(() => {
      expect(screen.getByText('Weiter')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Weiter'));
    expect(mockedNavigate).toHaveBeenCalledWith('/rules');
  });
});
