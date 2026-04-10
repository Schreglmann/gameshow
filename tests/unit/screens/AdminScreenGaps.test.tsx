import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import AdminScreen from '@/components/screens/AdminScreen';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
  }),
}));

describe('AdminScreen - Gaps', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    window.location.hash = '';
  });

  function renderAdmin() {
    return render(
      <MemoryRouter>
        <GameProvider>
          <AdminScreen />
        </GameProvider>
      </MemoryRouter>
    );
  }

  it('shows success message after resetting points and auto-dismisses after 3 seconds', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    localStorage.setItem('team1Points', '10');
    renderAdmin();

    await user.click(screen.getByText(/Punkte zurücksetzen/));

    expect(screen.getByText(/Punkte wurden zurückgesetzt/)).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(3000); });
    await waitFor(() => {
      expect(screen.queryByText(/Punkte wurden zurückgesetzt/)).not.toBeInTheDocument();
    });
  });

  it('shows success message after resetting points', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    localStorage.setItem('team1Points', '10');
    localStorage.setItem('team2Points', '20');
    renderAdmin();

    await user.click(screen.getByText(/Punkte zurücksetzen/));

    expect(screen.getByText(/Punkte wurden zurückgesetzt/)).toBeInTheDocument();

    expect(localStorage.getItem('team1Points')).toBe('0');
    expect(localStorage.getItem('team2Points')).toBe('0');
  });

  it('shows empty storage message when localStorage is empty', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAdmin();

    await user.click(screen.getByText('Anzeigen'));

    expect(screen.getByText('LocalStorage ist leer')).toBeInTheDocument();
  });

  it('shows storage items when localStorage has data', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    localStorage.setItem('team1', JSON.stringify(['Alice']));
    localStorage.setItem('team1Points', '10');
    renderAdmin();

    await user.click(screen.getByText('Anzeigen'));

    expect(screen.getByText('team1:')).toBeInTheDocument();
    expect(screen.getByText('team1Points:')).toBeInTheDocument();
  });

  it('toggles storage visibility', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    localStorage.setItem('test', 'value');
    renderAdmin();

    await user.click(screen.getByText('Anzeigen'));
    expect(screen.getByText('test:')).toBeInTheDocument();

    await user.click(screen.getByText('Verbergen'));
    expect(screen.queryByText('test:')).not.toBeInTheDocument();
  });

  it('clears all localStorage when Alles löschen is clicked (double confirm)', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    localStorage.setItem('team1', '[]');
    localStorage.setItem('team2', '[]');
    renderAdmin();

    await user.click(screen.getByText(/Alles löschen/));

    expect(localStorage.length).toBe(0);
    expect(screen.getByText(/Alle LocalStorage-Daten wurden gelöscht/)).toBeInTheDocument();
  });

  it('saves team names to localStorage on blur', async () => {
    renderAdmin();

    const team1Input = screen.getByPlaceholderText('Alice, Bob, ...');
    const team2Input = screen.getByPlaceholderText('Clara, Dave, ...');
    fireEvent.change(team1Input, { target: { value: 'Awesome Team' } });
    fireEvent.blur(team1Input);
    fireEvent.change(team2Input, { target: { value: 'Cool Team' } });
    fireEvent.blur(team2Input);

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('team1') || '[]')).toContain('Awesome Team');
      expect(JSON.parse(localStorage.getItem('team2') || '[]')).toContain('Cool Team');
    });
  });

  it('saves updated point inputs to localStorage on blur', async () => {
    renderAdmin();

    const spinbuttons = screen.getAllByRole('spinbutton');
    fireEvent.change(spinbuttons[0], { target: { value: '42' } });
    fireEvent.blur(spinbuttons[0]);
    fireEvent.change(spinbuttons[1], { target: { value: '99' } });
    fireEvent.blur(spinbuttons[1]);

    await waitFor(() => {
      expect(localStorage.getItem('team1Points')).toBe('42');
      expect(localStorage.getItem('team2Points')).toBe('99');
    });
  });

  it('loads existing team data on mount', () => {
    localStorage.setItem('team1', JSON.stringify(['Alpha']));
    localStorage.setItem('team2', JSON.stringify(['Beta']));
    localStorage.setItem('team1Points', '15');
    localStorage.setItem('team2Points', '25');

    renderAdmin();

    expect((screen.getByPlaceholderText('Alice, Bob, ...') as HTMLInputElement).value).toBe('Alpha');
    expect((screen.getByPlaceholderText('Clara, Dave, ...') as HTMLInputElement).value).toBe('Beta');
    const spinbuttons = screen.getAllByRole('spinbutton');
    expect((spinbuttons[0] as HTMLInputElement).value).toBe('15');
    expect((spinbuttons[1] as HTMLInputElement).value).toBe('25');
  });
});
