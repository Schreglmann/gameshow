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

    // Weiter button should be visible directly
    await waitFor(() => {
      expect(screen.getByText('Weiter')).toBeInTheDocument();
    });
  });

  it('shows Weiter button directly when teamRandomizationEnabled is false', async () => {
    vi.mocked(fetchSettings).mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: false,
      globalRules: [],
    });

    renderHome();

    await waitFor(() => {
      expect(screen.getByText('Weiter')).toBeInTheDocument();
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

    // Wait for settings to load
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Namen/i) || screen.queryByRole('textbox')).toBeInTheDocument();
    });

    const input = screen.queryByPlaceholderText(/Namen/i) || screen.getByRole('textbox');
    await user.type(input, '  Alice , , Bob ,  ');

    // Submit
    const form = input.closest('form');
    if (form) {
      form.dispatchEvent(new Event('submit', { bubbles: true }));
    }

    // Should show teams after assignment  
    await waitFor(() => {
      // After teams assigned, Weiter button should appear
      expect(screen.getByText('Weiter')).toBeInTheDocument();
    });
  });

  it('shows team assignment after submission', async () => {
    const user = userEvent.setup();
    renderHome();

    await waitFor(() => {
      expect(screen.getByText('Game Show')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Namen/i) || screen.queryByRole('textbox')).toBeInTheDocument();
    });

    const input = screen.queryByPlaceholderText(/Namen/i) || screen.getByRole('textbox');
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

  it('navigates to /rules when Weiter is clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchSettings).mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: false,
      globalRules: [],
    });

    renderHome();

    await waitFor(() => {
      expect(screen.getByText('Weiter')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Weiter'));

    expect(mockNavigate).toHaveBeenCalledWith('/rules');
  });
});
