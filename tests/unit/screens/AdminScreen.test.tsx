import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AdminScreen from '@/components/screens/AdminScreen';

describe('AdminScreen', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders team management section', () => {
    render(
      <MemoryRouter>
        <AdminScreen />
      </MemoryRouter>
    );
    expect(screen.getByText(/Team Verwaltung/)).toBeInTheDocument();
  });

  it('renders team name inputs', () => {
    render(
      <MemoryRouter>
        <AdminScreen />
      </MemoryRouter>
    );
    expect(screen.getByLabelText('Team 1 Name:')).toBeInTheDocument();
    expect(screen.getByLabelText('Team 2 Name:')).toBeInTheDocument();
  });

  it('renders team point inputs', () => {
    render(
      <MemoryRouter>
        <AdminScreen />
      </MemoryRouter>
    );
    expect(screen.getByLabelText('Team 1 Punkte:')).toBeInTheDocument();
    expect(screen.getByLabelText('Team 2 Punkte:')).toBeInTheDocument();
  });

  it('loads existing data from localStorage on mount', () => {
    localStorage.setItem('team1', '["Alice","Bob"]');
    localStorage.setItem('team2', '["Charlie"]');
    localStorage.setItem('team1Points', '15');
    localStorage.setItem('team2Points', '8');

    render(
      <MemoryRouter>
        <AdminScreen />
      </MemoryRouter>
    );

    const team1Input = screen.getByLabelText('Team 1 Name:') as HTMLInputElement;
    expect(team1Input.value).toBe('["Alice","Bob"]');

    const team1Points = screen.getByLabelText('Team 1 Punkte:') as HTMLInputElement;
    expect(team1Points.value).toBe('15');

    const team2Points = screen.getByLabelText('Team 2 Punkte:') as HTMLInputElement;
    expect(team2Points.value).toBe('8');
  });

  it('saves team data to localStorage when Speichern is clicked', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AdminScreen />
      </MemoryRouter>
    );

    const team1Input = screen.getByLabelText('Team 1 Name:');
    await user.clear(team1Input);
    await user.type(team1Input, 'New Team 1');

    const team1Points = screen.getByLabelText('Team 1 Punkte:');
    await user.clear(team1Points);
    await user.type(team1Points, '25');

    await user.click(screen.getByText(/Speichern/));

    expect(localStorage.getItem('team1')).toBe('New Team 1');
    expect(localStorage.getItem('team1Points')).toBe('25');

    // Success message
    await waitFor(() => {
      expect(screen.getByText(/erfolgreich gespeichert/)).toBeInTheDocument();
    });
  });

  it('resets points to zero when Punkte zurücksetzen is clicked', async () => {
    const user = userEvent.setup();
    localStorage.setItem('team1Points', '10');
    localStorage.setItem('team2Points', '20');

    render(
      <MemoryRouter>
        <AdminScreen />
      </MemoryRouter>
    );

    await user.click(screen.getByText(/Punkte zurücksetzen/));

    expect(localStorage.getItem('team1Points')).toBe('0');
    expect(localStorage.getItem('team2Points')).toBe('0');

    await waitFor(() => {
      expect(screen.getByText(/Punkte wurden zurückgesetzt/)).toBeInTheDocument();
    });
  });

  it('shows localStorage items when Alle Daten anzeigen is clicked', async () => {
    const user = userEvent.setup();
    localStorage.setItem('team1', 'Test');
    localStorage.setItem('team1Points', '5');

    render(
      <MemoryRouter>
        <AdminScreen />
      </MemoryRouter>
    );

    await user.click(screen.getByText(/Alle Daten anzeigen/));

    await waitFor(() => {
      expect(screen.getByText('team1:')).toBeInTheDocument();
      expect(screen.getByText('team1Points:')).toBeInTheDocument();
    });
  });

  it('clears all localStorage when Alle Daten löschen is clicked', async () => {
    const user = userEvent.setup();
    localStorage.setItem('team1', 'Test');
    localStorage.setItem('team2', 'Test2');

    render(
      <MemoryRouter>
        <AdminScreen />
      </MemoryRouter>
    );

    // window.confirm is mocked to return true in setup.ts
    await user.click(screen.getByText(/Alle Daten löschen/));

    expect(localStorage.length).toBe(0);
    await waitFor(() => {
      expect(screen.getByText(/Alle LocalStorage-Daten wurden gelöscht/)).toBeInTheDocument();
    });
  });

  it('renders back link to home', () => {
    render(
      <MemoryRouter>
        <AdminScreen />
      </MemoryRouter>
    );
    const link = screen.getByText(/Zurück zur Startseite/);
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('href', '/');
  });

  it('renders LocalStorage management section', () => {
    render(
      <MemoryRouter>
        <AdminScreen />
      </MemoryRouter>
    );
    expect(screen.getByText(/LocalStorage Verwaltung/)).toBeInTheDocument();
  });
});
