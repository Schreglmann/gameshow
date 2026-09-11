import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { __emitChannelForTests, __clearWsCacheForTests } from '@/services/useBackendSocket';
import SessionTab from '@/components/backend/SessionTab';
import type { TeamState } from '@/types/game';

/** Baseline snapshot a peer would publish; spread and override per test. */
const remoteTeams: TeamState = {
  team1: [], team2: [],
  team1Points: 0, team2Points: 0,
  team1JokersUsed: [], team2JokersUsed: [],
  scoreHistory: [], doubleNextGame: null,
};

const emitWsMessage = __emitChannelForTests;

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
  }),
  // The tab reads the SHOW's theme for the long-name check (see teamNames.ts).
  fetchTheme: vi.fn().mockResolvedValue({ frontend: 'galaxia', admin: 'galaxia' }),
  saveTheme: vi.fn().mockResolvedValue(undefined),
}));

function renderSessionTab() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <GameProvider>
          <SessionTab />
        </GameProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('SessionTab', () => {
  beforeEach(() => {
    localStorage.clear();
    // The WS last-value cache is module-level: without this, a team-state
    // emitted by one test is replayed to the next provider that subscribes.
    __clearWsCacheForTests();
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

  it('saves team inputs to localStorage on blur', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSessionTab();

    const team1Input = screen.getByPlaceholderText('Alice, Bob, ...');
    await user.clear(team1Input);
    await user.type(team1Input, 'Alice, Bob');
    await user.tab();

    await waitFor(() => {
      expect(localStorage.getItem('team1')).toBe('["Alice","Bob"]');
    });
  });

  it('saves team 2 input to localStorage on blur', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSessionTab();

    const team2Input = screen.getByPlaceholderText('Clara, Dave, ...');
    await user.clear(team2Input);
    await user.type(team2Input, 'Charlie');
    await user.tab();

    await waitFor(() => {
      expect(localStorage.getItem('team2')).toBe('["Charlie"]');
    });
  });

  it('does NOT save while input is still focused', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSessionTab();

    const team1Input = screen.getByPlaceholderText('Alice, Bob, ...');
    await user.type(team1Input, 'New');

    expect(localStorage.getItem('team1')).toBeNull();
  });

  it('saves team points to localStorage on blur', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSessionTab();

    const numberInputs = screen.getAllByRole('spinbutton');
    await user.clear(numberInputs[0]);
    await user.type(numberInputs[0], '42');
    await user.tab();

    await waitFor(() => {
      expect(localStorage.getItem('team1Points')).toBe('42');
    });
  });

  // ── Live sync (regression: the tab used to seed all six inputs once at mount
  // and re-publish that snapshot on every blur, so it displayed the score from
  // when it was opened and reverted live awards on all devices) ──

  it('refreshes a field from context when team state changes remotely', async () => {
    localStorage.setItem('team1Points', '3');
    renderSessionTab();
    expect(screen.getAllByRole('spinbutton')[0]).toHaveValue(3);

    await act(async () => {
      emitWsMessage('gamemaster-team-state-v2', { ...remoteTeams, team1Points: 11, rev: 5 });
    });

    await waitFor(() => {
      expect(screen.getAllByRole('spinbutton')[0]).toHaveValue(11);
    });
  });

  it('does NOT overwrite a field the operator is editing', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSessionTab();

    const team1Input = screen.getByPlaceholderText('Alice, Bob, ...');
    await user.type(team1Input, 'Alice');

    await act(async () => {
      emitWsMessage('gamemaster-team-state-v2', { ...remoteTeams, team1: ['Remote'], rev: 5 });
    });

    expect(team1Input).toHaveValue('Alice');
  });

  it('blurring an untouched field does NOT revert points awarded meanwhile', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSessionTab();

    // Operator opens the tab at 0, a game awards 7 while it sits open.
    await act(async () => {
      emitWsMessage('gamemaster-team-state-v2', { ...remoteTeams, team1Points: 7, rev: 5 });
    });

    // Focus and leave the name field without changing anything — this is the
    // live failure: switching apps on the iPad fires blur on the focused input.
    await user.click(screen.getByPlaceholderText('Team 1'));
    await user.tab();

    expect(localStorage.getItem('team1Points')).toBe('7');
    expect(screen.getAllByRole('spinbutton')[0]).toHaveValue(7);
  });

  it('an edit merges onto the CURRENT team state, not the mount-time snapshot', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSessionTab();

    // Team 2 scores 9 while the tab is open...
    await act(async () => {
      emitWsMessage('gamemaster-team-state-v2', { ...remoteTeams, team2Points: 9, rev: 5 });
    });

    // ...then the operator corrects team 1 only.
    const t1 = screen.getAllByRole('spinbutton')[0];
    await user.clear(t1);
    await user.type(t1, '4');
    await user.tab();

    await waitFor(() => {
      expect(localStorage.getItem('team1Points')).toBe('4');
    });
    expect(localStorage.getItem('team2Points')).toBe('9');
  });

  it('a blur that changed nothing does not show the saved message', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSessionTab();

    await user.click(screen.getByPlaceholderText('Team 1'));
    await user.tab();

    expect(screen.queryByText('Gespeichert')).not.toBeInTheDocument();
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

    expect(await screen.findByText(/Punkte wurden zurückgesetzt/)).toBeInTheDocument();
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

    // Every data key is gone. `teamStateRev` deliberately survives: it is the
    // stale-write counter, and a wipe that restarted it at 0 would be rejected
    // by the server's cached (higher) rev and the cleared state would come
    // straight back. See specs/cross-device-gamemaster.md.
    expect(localStorage.getItem('team1')).toBeNull();
    expect(localStorage.getItem('team2')).toBeNull();
    expect(localStorage.length).toBe(1);
    expect(localStorage.key(0)).toBe('teamStateRev');
  });

  it('shows success message after clearing all localStorage', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderSessionTab();

    await user.click(screen.getByRole('button', { name: /Alles löschen/ }));

    expect(await screen.findByText(/Alle LocalStorage-Daten wurden gelöscht/)).toBeInTheDocument();
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
    expect(await screen.findByText(/Punkte wurden zurückgesetzt/)).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(3000); });

    await waitFor(() => {
      expect(screen.queryByText(/Punkte wurden zurückgesetzt/)).not.toBeInTheDocument();
    });
  });
});
