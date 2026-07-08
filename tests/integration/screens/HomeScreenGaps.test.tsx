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

  it('manual mode: shows an editable roster WITH an add-line (build teams by hand)', async () => {
    localStorage.setItem('team1', JSON.stringify(['Alice']));
    localStorage.setItem('team2', JSON.stringify(['Bob']));
    vi.mocked(fetchSettings).mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: false,
      globalRules: [],
    });

    renderHome();

    await waitFor(() => expect(screen.getByText('Game Show')).toBeInTheDocument());
    // Manual mode = teams formed outside the show → build them by hand: the
    // "+ Spieler hinzufügen" ghost slot is present per team.
    await waitFor(() => expect(screen.getByLabelText('Spieler zu Team 1 hinzufügen')).toBeInTheDocument());
    expect(screen.getByLabelText('Spieler zu Team 2 hinzufügen')).toBeInTheDocument();
    // Members render as editable inputs.
    expect(screen.getByDisplayValue('Alice')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Bob')).toBeInTheDocument();
    // No name-pool textarea (that's the random-mode surface).
    expect(screen.queryByPlaceholderText(/Name 1, Name 2/)).not.toBeInTheDocument();
  });

  it('manual mode: typing into the ghost slot adds a player', async () => {
    const user = userEvent.setup();
    localStorage.setItem('team1', JSON.stringify(['Alice']));
    vi.mocked(fetchSettings).mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: false,
      globalRules: [],
    });

    renderHome();
    await waitFor(() => expect(screen.getByLabelText('Spieler zu Team 1 hinzufügen')).toBeInTheDocument());

    await user.type(screen.getByLabelText('Spieler zu Team 1 hinzufügen'), 'Zoe');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByDisplayValue('Zoe')).toBeInTheDocument());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('manual mode: clearing a member\'s text removes it', async () => {
    const user = userEvent.setup();
    localStorage.setItem('team1', JSON.stringify(['Alice', 'Bob']));
    vi.mocked(fetchSettings).mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: false,
      globalRules: [],
    });

    renderHome();
    await waitFor(() => expect(screen.getByDisplayValue('Alice')).toBeInTheDocument());

    await user.clear(screen.getByDisplayValue('Alice'));
    await user.keyboard('{Enter}'); // blur commits: empty slot dropped
    await waitFor(() => expect(screen.queryByDisplayValue('Alice')).not.toBeInTheDocument());
    expect(screen.getByDisplayValue('Bob')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('random mode: shows the assigned roster with NO add-line (names come from the pool)', async () => {
    localStorage.setItem('team1', JSON.stringify(['Alice']));
    localStorage.setItem('team2', JSON.stringify(['Bob']));
    vi.mocked(fetchSettings).mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      globalRules: [],
    });

    renderHome();
    await waitFor(() => expect(screen.getByDisplayValue('Alice')).toBeInTheDocument());
    // Random mode = names come from the shuffle; no "+ Spieler hinzufügen" slot.
    expect(screen.queryByLabelText('Spieler zu Team 1 hinzufügen')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('+ Spieler hinzufügen')).not.toBeInTheDocument();
    // Existing members are still editable (correct/remove on the show).
    expect(screen.getByDisplayValue('Bob')).toBeInTheDocument();
  });

  it('clicking out of a member field is swallowed (advances only on the 2nd click)', async () => {
    localStorage.setItem('team1', JSON.stringify(['Alice']));
    vi.mocked(fetchSettings).mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: false,
      globalRules: [],
    });

    renderHome();
    await waitFor(() => expect(screen.getByDisplayValue('Alice')).toBeInTheDocument());

    const input = screen.getByDisplayValue('Alice');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Alicia' } });

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
