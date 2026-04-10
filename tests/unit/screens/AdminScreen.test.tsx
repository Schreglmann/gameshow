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

function renderAdmin() {
  return render(
    <MemoryRouter>
      <GameProvider>
        <AdminScreen />
      </GameProvider>
    </MemoryRouter>
  );
}

describe('AdminScreen', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    window.location.hash = '';
  });

  it('renders team management section', () => {
    renderAdmin();
    expect(screen.getByText(/Team Verwaltung/)).toBeInTheDocument();
  });

  it('renders team name inputs', () => {
    renderAdmin();
    expect(screen.getByPlaceholderText('Alice, Bob, ...')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Clara, Dave, ...')).toBeInTheDocument();
  });

  it('renders team point inputs', () => {
    renderAdmin();
    const pointInputs = screen.getAllByRole('spinbutton');
    expect(pointInputs).toHaveLength(2);
  });

  it('loads existing data from localStorage on mount', () => {
    localStorage.setItem('team1', '["Alice","Bob"]');
    localStorage.setItem('team2', '["Charlie"]');
    localStorage.setItem('team1Points', '15');
    localStorage.setItem('team2Points', '8');

    renderAdmin();

    const team1Input = screen.getByPlaceholderText('Alice, Bob, ...') as HTMLInputElement;
    expect(team1Input.value).toBe('Alice, Bob');

    const spinbuttons = screen.getAllByRole('spinbutton');
    expect((spinbuttons[0] as HTMLInputElement).value).toBe('15');
    expect((spinbuttons[1] as HTMLInputElement).value).toBe('8');
  });

  it('saves team data to localStorage on blur', async () => {
    renderAdmin();

    const input = screen.getByPlaceholderText('Alice, Bob, ...');
    fireEvent.change(input, { target: { value: 'New Team 1' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('team1') || '[]')).toContain('New Team 1');
    });
  });

  it('resets points to zero when Punkte zurücksetzen is clicked', async () => {
    const user = userEvent.setup();
    localStorage.setItem('team1Points', '10');
    localStorage.setItem('team2Points', '20');

    renderAdmin();

    await user.click(screen.getByText(/Punkte zurücksetzen/));

    expect(localStorage.getItem('team1Points')).toBe('0');
    expect(localStorage.getItem('team2Points')).toBe('0');

    await waitFor(() => {
      expect(screen.getByText(/Punkte wurden zurückgesetzt/)).toBeInTheDocument();
    });
  });

  it('shows localStorage items when Anzeigen is clicked', async () => {
    const user = userEvent.setup();
    localStorage.setItem('team1', '["Test"]');
    localStorage.setItem('team1Points', '5');

    renderAdmin();

    await user.click(screen.getByText('Anzeigen'));

    await waitFor(() => {
      expect(screen.getByText('team1:')).toBeInTheDocument();
      expect(screen.getByText('team1Points:')).toBeInTheDocument();
    });
  });

  it('clears all localStorage when Alles löschen is clicked', async () => {
    const user = userEvent.setup();
    localStorage.setItem('team1', '[]');
    localStorage.setItem('team2', '[]');

    renderAdmin();

    await user.click(screen.getByText(/Alles löschen/));

    expect(localStorage.length).toBe(0);
    await waitFor(() => {
      expect(screen.getByText(/Alle LocalStorage-Daten wurden gelöscht/)).toBeInTheDocument();
    });
  });

  it('renders back link to home', () => {
    renderAdmin();
    const link = screen.getByText('← Home');
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('href', '/');
  });

  it('renders LocalStorage management section', () => {
    renderAdmin();
    expect(screen.getByText('LocalStorage')).toBeInTheDocument();
  });
});
