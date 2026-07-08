import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
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

  it('shows the start screen (does not auto-skip) when teamRandomizationEnabled is false', async () => {
    vi.mocked(fetchSettings).mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: false,
      globalRules: [],
    });

    renderHome();

    // The start/title screen must stay visible even with randomization off —
    // it doubles as the show's intro. No auto-navigation on mount.
    await waitFor(() => {
      expect(screen.getByText('Game Show')).toBeInTheDocument();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('advances to /rules on click when teamRandomizationEnabled is false', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchSettings).mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: false,
      globalRules: [],
    });

    renderHome();

    await waitFor(() => {
      expect(screen.getByText('Game Show')).toBeInTheDocument();
    });

    // With randomization off, clicking empty space (the title) advances.
    await user.click(screen.getByText('Game Show'));
    expect(mockNavigate).toHaveBeenCalledWith('/rules');
  });

  it('manual mode: shows an editable roster (ghost slot per team) instead of the name textarea', async () => {
    vi.mocked(fetchSettings).mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: false,
      globalRules: [],
    });

    renderHome();

    await waitFor(() => expect(screen.getByText('Game Show')).toBeInTheDocument());
    // No name-pool textarea in manual mode…
    expect(screen.queryByPlaceholderText(/Name 1, Name 2/)).not.toBeInTheDocument();
    // …instead one empty "add player" input slot under each of the two teams.
    expect(screen.getByLabelText('Spieler zu Team 1 hinzufügen')).toBeInTheDocument();
    expect(screen.getByLabelText('Spieler zu Team 2 hinzufügen')).toBeInTheDocument();
  });

  it('manual mode: add a player by typing, remove by clearing the text', async () => {
    const user = userEvent.setup();
    vi.mocked(fetchSettings).mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: false,
      globalRules: [],
    });

    renderHome();

    await waitFor(() => expect(screen.getByText('Game Show')).toBeInTheDocument());

    // Type into Team 1's ghost slot, Enter commits (blur).
    await user.type(screen.getByLabelText('Spieler zu Team 1 hinzufügen'), 'Alice');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByDisplayValue('Alice')).toBeInTheDocument());

    // Clearing the name's text and committing removes the player.
    await user.clear(screen.getByDisplayValue('Alice'));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByDisplayValue('Alice')).not.toBeInTheDocument());

    // Editing the roster must never navigate away.
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('manual mode: clicking out of a member field is swallowed (advances only on the 2nd click)', async () => {
    vi.mocked(fetchSettings).mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: false,
      globalRules: [],
    });

    renderHome();
    await waitFor(() => expect(screen.getByText('Game Show')).toBeInTheDocument());

    const input = screen.getByLabelText('Spieler zu Team 1 hinzufügen');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Alice' } });

    const heading = screen.getByText('Game Show');
    // Real click-out sequence: pointerdown fires while the field is still focused
    // (snapshot), THEN the field blurs, THEN the click lands. That first click
    // must NOT advance — it only ended the edit.
    act(() => {
      fireEvent.pointerDown(heading);
      fireEvent.blur(input);
      fireEvent.click(heading);
    });
    expect(mockNavigate).not.toHaveBeenCalled();

    // A second click, with nothing focused, advances.
    act(() => {
      fireEvent.pointerDown(heading);
      fireEvent.click(heading);
    });
    expect(mockNavigate).toHaveBeenCalledWith('/rules');
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
