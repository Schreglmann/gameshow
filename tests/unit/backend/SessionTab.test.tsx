import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import SessionTab from '@/components/backend/SessionTab';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
  }),
}));

function renderSessionTab() {
  return render(
    <MemoryRouter>
      <GameProvider>
        <SessionTab />
      </GameProvider>
    </MemoryRouter>
  );
}

describe('SessionTab', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders Team Verwaltung card', () => {
    renderSessionTab();
    expect(screen.getByText('Team Verwaltung')).toBeInTheDocument();
  });

  it('renders team member labels', () => {
    renderSessionTab();
    expect(screen.getByText('Team 1 Mitglieder')).toBeInTheDocument();
    expect(screen.getByText('Team 2 Mitglieder')).toBeInTheDocument();
  });

  it('renders team points labels', () => {
    renderSessionTab();
    expect(screen.getByText('Team 1 Punkte')).toBeInTheDocument();
    expect(screen.getByText('Team 2 Punkte')).toBeInTheDocument();
  });

  it('renders reset points button', () => {
    renderSessionTab();
    expect(screen.getByRole('button', { name: /Punkte zurücksetzen/ })).toBeInTheDocument();
  });

  it('renders LocalStorage card', () => {
    renderSessionTab();
    expect(screen.getByText('LocalStorage')).toBeInTheDocument();
  });

  it('renders Anzeigen button initially', () => {
    renderSessionTab();
    expect(screen.getByRole('button', { name: 'Anzeigen' })).toBeInTheDocument();
  });

  it('initializes team inputs from localStorage', () => {
    localStorage.setItem('team1', JSON.stringify(['Alice', 'Bob']));
    localStorage.setItem('team2', JSON.stringify(['Charlie']));
    renderSessionTab();
    expect(screen.getByDisplayValue('Alice, Bob')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Charlie')).toBeInTheDocument();
  });

  it('initializes points inputs from localStorage', () => {
    localStorage.setItem('team1Points', '10');
    localStorage.setItem('team2Points', '25');
    renderSessionTab();
    const numberInputs = screen.getAllByRole('spinbutton');
    expect((numberInputs[0] as HTMLInputElement).value).toBe('10');
    expect((numberInputs[1] as HTMLInputElement).value).toBe('25');
  });

  it('initializes with empty team inputs when localStorage is empty', () => {
    renderSessionTab();
    expect(screen.getByPlaceholderText('Alice, Bob, ...')).toHaveValue('');
    expect(screen.getByPlaceholderText('Clara, Dave, ...')).toHaveValue('');
  });

  it('initializes points to 0 when localStorage is empty', () => {
    renderSessionTab();
    const numberInputs = screen.getAllByRole('spinbutton');
    expect((numberInputs[0] as HTMLInputElement).value).toBe('0');
    expect((numberInputs[1] as HTMLInputElement).value).toBe('0');
  });

  it('auto-saves team inputs to localStorage after 800ms debounce', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSessionTab();

    const team1Input = screen.getByPlaceholderText('Alice, Bob, ...');
    await user.clear(team1Input);
    await user.type(team1Input, 'Alice, Bob');

    act(() => { vi.advanceTimersByTime(800); });

    await waitFor(() => {
      expect(localStorage.getItem('team1')).toBe('["Alice","Bob"]');
    });
  });

  it('auto-saves team 2 input to localStorage after 800ms', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSessionTab();

    const team2Input = screen.getByPlaceholderText('Clara, Dave, ...');
    await user.clear(team2Input);
    await user.type(team2Input, 'Charlie');

    act(() => { vi.advanceTimersByTime(800); });

    await waitFor(() => {
      expect(localStorage.getItem('team2')).toBe('["Charlie"]');
    });
  });

  it('does NOT save before 800ms debounce', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSessionTab();

    const team1Input = screen.getByPlaceholderText('Alice, Bob, ...');
    await user.type(team1Input, 'New');

    act(() => { vi.advanceTimersByTime(400); });

    expect(localStorage.getItem('team1')).toBeNull();
  });

  it('auto-saves team points to localStorage after 800ms', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSessionTab();

    const numberInputs = screen.getAllByRole('spinbutton');
    await user.clear(numberInputs[0]);
    await user.type(numberInputs[0], '42');

    act(() => { vi.advanceTimersByTime(800); });

    await waitFor(() => {
      expect(localStorage.getItem('team1Points')).toBe('42');
    });
  });

  it('resets points to 0 when reset button is clicked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    localStorage.setItem('team1Points', '10');
    localStorage.setItem('team2Points', '20');
    renderSessionTab();

    await user.click(screen.getByRole('button', { name: /Punkte zurücksetzen/ }));

    const numberInputs = screen.getAllByRole('spinbutton');
    expect((numberInputs[0] as HTMLInputElement).value).toBe('0');
    expect((numberInputs[1] as HTMLInputElement).value).toBe('0');
  });

  it('resets points in localStorage when reset button is clicked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    localStorage.setItem('team1Points', '10');
    localStorage.setItem('team2Points', '20');
    renderSessionTab();

    await user.click(screen.getByRole('button', { name: /Punkte zurücksetzen/ }));

    expect(localStorage.getItem('team1Points')).toBe('0');
    expect(localStorage.getItem('team2Points')).toBe('0');
  });

  it('requires confirm before resetting points', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSessionTab();

    await user.click(screen.getByRole('button', { name: /Punkte zurücksetzen/ }));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Punkte'));
    confirmSpy.mockRestore();
  });

  it('does NOT reset points when confirm is cancelled', async () => {
    window.confirm = vi.fn(() => false);
    localStorage.setItem('team1Points', '10');
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSessionTab();

    await user.click(screen.getByRole('button', { name: /Punkte zurücksetzen/ }));

    expect(localStorage.getItem('team1Points')).toBe('10');
    window.confirm = () => true;
  });

  it('shows success message after resetting points', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSessionTab();

    await user.click(screen.getByRole('button', { name: /Punkte zurücksetzen/ }));

    expect(screen.getByText(/Punkte wurden zurückgesetzt/)).toBeInTheDocument();
  });

  it('toggles localStorage viewer on "Anzeigen" click', async () => {
    localStorage.setItem('team1', '["Test"]');
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSessionTab();

    await user.click(screen.getByRole('button', { name: 'Anzeigen' }));

    expect(screen.getByText('team1:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verbergen' })).toBeInTheDocument();
  });

  it('hides localStorage viewer when "Verbergen" is clicked', async () => {
    localStorage.setItem('team1', '["Test"]');
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSessionTab();

    await user.click(screen.getByRole('button', { name: 'Anzeigen' }));
    expect(screen.getByText('team1:')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Verbergen' }));
    expect(screen.queryByText('team1:')).not.toBeInTheDocument();
  });

  it('shows all localStorage keys and values when viewer is open', async () => {
    localStorage.setItem('team1', '["Alice"]');
    localStorage.setItem('team1Points', '5');
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSessionTab();

    await user.click(screen.getByRole('button', { name: 'Anzeigen' }));

    expect(screen.getByText('team1:')).toBeInTheDocument();
    expect(screen.getByText('team1Points:')).toBeInTheDocument();
  });

  it('shows "LocalStorage ist leer" when storage is empty and viewer is opened', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSessionTab();

    await user.click(screen.getByRole('button', { name: 'Anzeigen' }));

    expect(screen.getByText('LocalStorage ist leer')).toBeInTheDocument();
  });

  it('renders delete all button', () => {
    renderSessionTab();
    expect(screen.getByRole('button', { name: /Alles löschen/ })).toBeInTheDocument();
  });

  it('clears all localStorage on double confirm', async () => {
    localStorage.setItem('team1', '["Test"]');
    localStorage.setItem('team2', '["Foo"]');
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSessionTab();

    await user.click(screen.getByRole('button', { name: /Alles löschen/ }));

    expect(localStorage.length).toBe(0);
  });

  it('shows success message after clearing all localStorage', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSessionTab();

    await user.click(screen.getByRole('button', { name: /Alles löschen/ }));

    expect(screen.getByText(/Alle LocalStorage-Daten wurden gelöscht/)).toBeInTheDocument();
  });

  it('hides storage viewer after clearing all localStorage', async () => {
    localStorage.setItem('test', 'val');
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSessionTab();

    await user.click(screen.getByRole('button', { name: 'Anzeigen' }));
    expect(screen.getByText('test:')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Alles löschen/ }));

    expect(screen.queryByText('test:')).not.toBeInTheDocument();
  });

  it('does NOT clear localStorage when first confirm is cancelled', async () => {
    window.confirm = vi.fn(() => false);
    localStorage.setItem('team1', '["Test"]');
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSessionTab();

    await user.click(screen.getByRole('button', { name: /Alles löschen/ }));

    expect(localStorage.getItem('team1')).toBe('["Test"]');
    window.confirm = () => true;
  });

  it('success message auto-dismisses after 3000ms', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSessionTab();

    await user.click(screen.getByRole('button', { name: /Punkte zurücksetzen/ }));
    expect(screen.getByText(/Punkte wurden zurückgesetzt/)).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(3000); });

    await waitFor(() => {
      expect(screen.queryByText(/Punkte wurden zurückgesetzt/)).not.toBeInTheDocument();
    });
  });
});
