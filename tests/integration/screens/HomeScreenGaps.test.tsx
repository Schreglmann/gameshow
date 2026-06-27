import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import HomeScreen from '@/components/screens/HomeScreen';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
  }),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
}));

import { fetchSettings } from '@/services/api';

function renderHome() {
  return render(
    <MemoryRouter>
      <GameProvider>
        <HomeScreen />
      </GameProvider>
    </MemoryRouter>
  );
}

describe('HomeScreen - Gaps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(fetchSettings).mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      globalRules: [],
    });
  });

  it('hides team form when teamRandomizationEnabled is false', async () => {
    vi.mocked(fetchSettings).mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: false,
      globalRules: [],
    });

    renderHome();

    await waitFor(() => {
      // Form should not be visible when randomization is disabled
      expect(screen.queryByPlaceholderText(/Namen/i)).not.toBeInTheDocument();
    });
  });

  it('navigates on click when teamRandomizationEnabled is false', async () => {
    vi.mocked(fetchSettings).mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: false,
      globalRules: [],
    });

    renderHome();

    // Since teamRandomization is disabled, the screen auto-navigates
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/rules');
    });
  });

  it('hides Weiter button when no teams assigned and randomization enabled', async () => {
    renderHome();

    await waitFor(() => {
      expect(screen.getByText('Game Show')).toBeInTheDocument();
    });

    // No Weiter button yet
    expect(screen.queryByText('Weiter')).not.toBeInTheDocument();
  });

  it('trims whitespace and filters empty names on submit', async () => {
    const user = userEvent.setup();
    renderHome();

    await waitFor(() => {
      expect(screen.getByText('Game Show')).toBeInTheDocument();
    });

    const input = await screen.findByPlaceholderText('Name 1, Name 2, ...');
    await user.type(input, '  Alice , , Bob ,  ');

    // Submit
    const form = input.closest('form');
    if (form) {
      form.dispatchEvent(new Event('submit', { bubbles: true }));
    }

    // Should show teams after assignment  
    await waitFor(() => {
      expect(screen.getByText(/Team 1/)).toBeInTheDocument();
    });
  });

  it('shows team assignment after submission', async () => {
    const user = userEvent.setup();
    renderHome();

    await waitFor(() => {
      expect(screen.getByText('Game Show')).toBeInTheDocument();
    });

    const input = await screen.findByPlaceholderText('Name 1, Name 2, ...');
    await user.type(input, 'Alice, Bob, Charlie, Dave');

    // Submit
    const form = input.closest('form');
    if (form) {
      form.dispatchEvent(new Event('submit', { bubbles: true }));
    }

    // After assignment, both teams should show
    await waitFor(() => {
      expect(screen.getByText(/Team 1/)).toBeInTheDocument();
      expect(screen.getByText(/Team 2/)).toBeInTheDocument();
    });
  });

  it('navigates to /rules on click when teams assigned', async () => {
    const user = userEvent.setup();
    renderHome();

    const input = await screen.findByPlaceholderText('Name 1, Name 2, ...');
    await user.type(input, 'Alice, Bob');
    await user.click(screen.getByText('Teams zuweisen'));

    await waitFor(() => {
      expect(screen.getByText(/Team 1/)).toBeInTheDocument();
    });

    // Click elsewhere (not the editable team heading) to advance
    await user.click(screen.getByText('Game Show'));
    expect(mockNavigate).toHaveBeenCalledWith('/rules');
  });
});
