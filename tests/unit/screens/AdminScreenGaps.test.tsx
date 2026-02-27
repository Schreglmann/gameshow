import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AdminScreen from '@/components/screens/AdminScreen';

describe('AdminScreen - Gaps', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderAdmin() {
    return render(
      <MemoryRouter>
        <AdminScreen />
      </MemoryRouter>
    );
  }

  it('shows success message after saving and auto-dismisses after 3 seconds', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAdmin();

    await user.click(screen.getByText(/Speichern/));

    expect(screen.getByText(/erfolgreich gespeichert/)).toBeInTheDocument();

    // Auto-dismiss after 3 seconds
    act(() => { vi.advanceTimersByTime(3000); });
    await waitFor(() => {
      expect(screen.queryByText(/erfolgreich gespeichert/)).not.toBeInTheDocument();
    });
  });

  it('shows success message after resetting points', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    localStorage.setItem('team1Points', '10');
    localStorage.setItem('team2Points', '20');
    renderAdmin();

    await user.click(screen.getByText(/Punkte zurücksetzen/));

    expect(screen.getByText(/Punkte wurden zurückgesetzt/)).toBeInTheDocument();

    // Points should be 0
    expect(localStorage.getItem('team1Points')).toBe('0');
    expect(localStorage.getItem('team2Points')).toBe('0');
  });

  it('shows empty storage message when localStorage is empty', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAdmin();

    await user.click(screen.getByText(/Alle Daten anzeigen/));

    expect(screen.getByText('LocalStorage ist leer')).toBeInTheDocument();
  });

  it('shows storage items when localStorage has data', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    localStorage.setItem('team1', JSON.stringify(['Alice']));
    localStorage.setItem('team1Points', '10');
    renderAdmin();

    await user.click(screen.getByText(/Alle Daten anzeigen/));

    expect(screen.getByText('team1:')).toBeInTheDocument();
    expect(screen.getByText('team1Points:')).toBeInTheDocument();
  });

  it('toggles storage visibility', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    localStorage.setItem('test', 'value');
    renderAdmin();

    // Open
    await user.click(screen.getByText(/Alle Daten anzeigen/));
    expect(screen.getByText('test:')).toBeInTheDocument();

    // Close
    await user.click(screen.getByText(/Alle Daten anzeigen/));
    expect(screen.queryByText('test:')).not.toBeInTheDocument();
  });

  it('clears all localStorage when Alle Daten löschen is clicked (double confirm)', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    localStorage.setItem('team1', 'test');
    localStorage.setItem('team2', 'test2');
    renderAdmin();

    // window.confirm is mocked to return true
    await user.click(screen.getByText(/Alle Daten löschen/));

    expect(localStorage.length).toBe(0);
    expect(screen.getByText(/Alle LocalStorage-Daten wurden gelöscht/)).toBeInTheDocument();
  });

  it('saves team names and points to localStorage', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAdmin();

    await user.clear(screen.getByLabelText('Team 1 Name:'));
    await user.type(screen.getByLabelText('Team 1 Name:'), 'Awesome Team');
    await user.clear(screen.getByLabelText('Team 2 Name:'));
    await user.type(screen.getByLabelText('Team 2 Name:'), 'Cool Team');

    await user.click(screen.getByText(/Speichern/));

    expect(localStorage.getItem('team1')).toBe('Awesome Team');
    expect(localStorage.getItem('team2')).toBe('Cool Team');
  });

  it('updates point inputs and saves them', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAdmin();

    const t1Points = screen.getByLabelText('Team 1 Punkte:') as HTMLInputElement;
    const t2Points = screen.getByLabelText('Team 2 Punkte:') as HTMLInputElement;

    await user.clear(t1Points);
    await user.type(t1Points, '42');
    await user.clear(t2Points);
    await user.type(t2Points, '99');

    await user.click(screen.getByText(/Speichern/));

    expect(localStorage.getItem('team1Points')).toBe('42');
    expect(localStorage.getItem('team2Points')).toBe('99');
  });

  it('loads existing team data on mount', () => {
    localStorage.setItem('team1', 'Alpha');
    localStorage.setItem('team2', 'Beta');
    localStorage.setItem('team1Points', '15');
    localStorage.setItem('team2Points', '25');

    renderAdmin();

    expect((screen.getByLabelText('Team 1 Name:') as HTMLInputElement).value).toBe('Alpha');
    expect((screen.getByLabelText('Team 2 Name:') as HTMLInputElement).value).toBe('Beta');
    expect((screen.getByLabelText('Team 1 Punkte:') as HTMLInputElement).value).toBe('15');
    expect((screen.getByLabelText('Team 2 Punkte:') as HTMLInputElement).value).toBe('25');
  });
});
