import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import { fetchSettings } from '@/services/api';
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

const mockedFetchSettings = vi.mocked(fetchSettings);

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
    mockedFetchSettings.mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      globalRules: ['Rule 1'],
    });
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

  it('prefills the randomization textarea with the configured gameshow roster', async () => {
    mockedFetchSettings.mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      globalRules: ['Rule 1'],
      players: ['Alice', 'Bob', 'Charlie'],
    });
    renderHomeScreen();

    const textarea = await screen.findByPlaceholderText('Name 1, Name 2, ...');
    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe('Alice, Bob, Charlie');
    });
  });

  it('leaves the textarea blank when the gameshow has no configured roster', async () => {
    renderHomeScreen();

    const textarea = await screen.findByPlaceholderText('Name 1, Name 2, ...');
    // settings have loaded (globalRules applied) but no roster → still empty
    await waitFor(() => expect(screen.getByText('Teams zuweisen')).toBeInTheDocument());
    expect((textarea as HTMLTextAreaElement).value).toBe('');
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

    // All names should appear as editable roster inputs (values, not text nodes).
    expect(screen.getByDisplayValue('Alice')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Bob')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Charlie')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Dave')).toBeInTheDocument();
  });

  it('navigates to /rules on click after teams are assigned', async () => {
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
      expect(screen.getByText('Team 1')).toBeInTheDocument();
    });

    // Click anywhere (except the editable team heading) to advance
    await user.click(screen.getByText('Game Show'));
    expect(mockedNavigate).toHaveBeenCalledWith('/rules');
  });

  it('renames a team by clicking its heading (no navigation)', async () => {
    const user = userEvent.setup();
    renderHomeScreen();

    const input = await screen.findByPlaceholderText('Name 1, Name 2, ...');
    await user.type(input, 'Alice, Bob');
    await user.click(screen.getByText('Teams zuweisen'));

    await waitFor(() => {
      expect(screen.getByText('Team 1')).toBeInTheDocument();
    });

    // Clicking the heading enters edit mode instead of advancing
    await user.click(screen.getByText('Team 1'));
    expect(mockedNavigate).not.toHaveBeenCalled();

    const editInput = screen.getByLabelText('Name Team 1');
    await user.type(editInput, 'Die Adler{Enter}');

    await waitFor(() => {
      expect(screen.getByText('Die Adler')).toBeInTheDocument();
    });
    expect(mockedNavigate).not.toHaveBeenCalled();
  });
});
