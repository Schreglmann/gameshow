import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import { fetchSettings } from '@/services/api';
import * as backendSocket from '@/services/useBackendSocket';
import { __emitChannelForTests } from '@/services/useBackendSocket';
import HomeScreen from '@/components/screens/HomeScreen';

// Mock API
vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    teamMirrorEnabled: true,
    globalRules: ['Rule 1'],
  }),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
}));

const mockedFetchSettings = vi.mocked(fetchSettings);

// Mock useNavigate
const mockedNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockedNavigate,
  };
});

function renderHomeScreen() {
  return render(
    <BrowserRouter>
      <GameProvider>
        <MusicProvider>
          <HomeScreen />
        </MusicProvider>
      </GameProvider>
    </BrowserRouter>
  );
}

/** Type names into the add field, add them, then press "Teams zuweisen". */
async function addAndReveal(user: ReturnType<typeof userEvent.setup>, names: string) {
  const input = await screen.findByLabelText('Name hinzufügen');
  await user.type(input, names);
  await user.click(screen.getByRole('button', { name: 'Hinzufügen' }));
  await user.click(screen.getByRole('button', { name: 'Teams zuweisen' }));
}

describe('HomeScreen', () => {
  beforeEach(() => {
    localStorage.clear();
    mockedNavigate.mockClear();
    mockedFetchSettings.mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      teamMirrorEnabled: true,
      globalRules: ['Rule 1'],
    });
  });

  it('renders the Game Show heading', () => {
    renderHomeScreen();
    expect(screen.getByText('Game Show')).toBeInTheDocument();
  });

  // The operator-configurable landing-page title — see specs/show-title.md. The
  // whole assertion waits, because the heading only changes once the async
  // settings load has landed.
  it('renders the operator-configured show title instead of the default', async () => {
    mockedFetchSettings.mockResolvedValue({
      showTitle: 'Sommerfest Quiz 2026',
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      teamMirrorEnabled: true,
      globalRules: ['Rule 1'],
    });
    renderHomeScreen();
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sommerfest Quiz 2026');
    });
    expect(screen.queryByText('Game Show')).not.toBeInTheDocument();
  });

  it('swaps the on-show team-card order when orderSwapped is set', async () => {
    localStorage.setItem('team1', JSON.stringify(['Anna']));
    localStorage.setItem('team2', JSON.stringify(['Ben']));
    localStorage.setItem('teamOrderSwapped', 'true');
    renderHomeScreen();
    await waitFor(() => expect(document.querySelector('#teams .team')).not.toBeNull());
    const ids = Array.from(document.querySelectorAll('#teams .team')).map(t => t.id);
    expect(ids).toEqual(['team2', 'team1']);
  });

  it('mirrors the GM "Teamname ändern" buttons (team 2 first by default)', async () => {
    localStorage.setItem('team1', JSON.stringify(['Anna']));
    localStorage.setItem('team2', JSON.stringify(['Ben']));
    const sendWsSpy = vi.spyOn(backendSocket, 'sendWs');
    renderHomeScreen();
    await waitFor(() => expect(document.querySelector('#teams .team')).not.toBeNull());

    type Ctrl = { id: string; buttons?: { id: string }[] };
    type Payload = { controls?: Ctrl[] } | null;
    // The order depends on teamMirrorEnabled, which loads async from
    // /api/settings — poll until the mirrored broadcast lands.
    await waitFor(() => {
      const editGroups = sendWsSpy.mock.calls
        .filter(([ch]) => ch === 'gamemaster-controls')
        .map(([, d]) => (d as Payload)?.controls?.find(c => c.id === 'edit-team'))
        .filter((c): c is Ctrl => Boolean(c));
      expect(editGroups.length).toBeGreaterThan(0);
      // GM faces the crowd → mirror: team 2's rename button comes first with no swap.
      expect(editGroups[editGroups.length - 1]!.buttons!.map(b => b.id)).toEqual(['edit-team2', 'edit-team1']);
    });
    sendWsSpy.mockRestore();
  });

  it('hides the swap button and GM mirror when teamMirrorEnabled is off (default)', async () => {
    mockedFetchSettings.mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      teamMirrorEnabled: false,
      globalRules: ['Rule 1'],
    });
    localStorage.setItem('team1', JSON.stringify(['Anna']));
    localStorage.setItem('team2', JSON.stringify(['Ben']));
    const sendWsSpy = vi.spyOn(backendSocket, 'sendWs');
    renderHomeScreen();
    await waitFor(() => expect(document.querySelector('#teams .team')).not.toBeNull());

    expect(document.querySelector('.swap-teams-button')).toBeNull();

    type Ctrl = { id: string; buttons?: { id: string }[] };
    type Payload = { controls?: Ctrl[] } | null;
    const controlsPayloads = sendWsSpy.mock.calls
      .filter(([ch]) => ch === 'gamemaster-controls')
      .map(([, d]) => d as Payload);
    const lastEditGroup = controlsPayloads
      .map(p => p?.controls?.find(c => c.id === 'edit-team'))
      .filter((c): c is Ctrl => Boolean(c))
      .at(-1);
    expect(lastEditGroup?.buttons?.map(b => b.id)).toEqual(['edit-team1', 'edit-team2']);
    expect(controlsPayloads.some(p => p?.controls?.some(c => c.id === 'swap-teams'))).toBe(false);
    sendWsSpy.mockRestore();
  });

  it('hides the team overview and shows a start prompt when the point system is off', async () => {
    // Point system off → the show has no teams: no assignment textarea, no team
    // cards, just the "Game Show" title and a start prompt. Even though team
    // randomization is on, no team UI appears.
    mockedFetchSettings.mockResolvedValue({
      pointSystemEnabled: false,
      teamRandomizationEnabled: true,
      teamMirrorEnabled: false,
      globalRules: ['Rule 1'],
    });
    localStorage.setItem('team1', JSON.stringify(['Anna']));
    localStorage.setItem('team2', JSON.stringify(['Ben']));
    renderHomeScreen();

    await waitFor(() => {
      expect(screen.getByText('Zum Starten klicken')).toBeInTheDocument();
    });
    expect(screen.queryByPlaceholderText('Name 1, Name 2, ...')).not.toBeInTheDocument();
    expect(document.querySelector('#teams')).toBeNull();
  });

  it('advances to /rules on click when the point system is off (no teams)', async () => {
    const user = userEvent.setup();
    mockedFetchSettings.mockResolvedValue({
      pointSystemEnabled: false,
      teamRandomizationEnabled: true,
      teamMirrorEnabled: false,
      globalRules: ['Rule 1'],
    });
    renderHomeScreen();

    await waitFor(() => {
      expect(screen.getByText('Zum Starten klicken')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Game Show'));
    expect(mockedNavigate).toHaveBeenCalledWith('/rules');
  });

  it('collapses the gamemaster controls to a single nav-forward when the point system is off', async () => {
    mockedFetchSettings.mockResolvedValue({
      pointSystemEnabled: false,
      teamRandomizationEnabled: true,
      teamMirrorEnabled: false,
      globalRules: ['Rule 1'],
    });
    const sendWsSpy = vi.spyOn(backendSocket, 'sendWs');
    renderHomeScreen();

    await waitFor(() => {
      expect(screen.getByText('Zum Starten klicken')).toBeInTheDocument();
    });

    type Ctrl = { id: string; type: string };
    type Payload = { controls?: Ctrl[] } | null;
    const lastControls = sendWsSpy.mock.calls
      .filter(([ch]) => ch === 'gamemaster-controls')
      .map(([, d]) => (d as Payload)?.controls)
      .filter((c): c is Ctrl[] => Array.isArray(c))
      .at(-1);
    expect(lastControls?.map(c => c.id)).toEqual(['nav']);
    expect(lastControls?.some(c => c.id.startsWith('assign') || c.id.startsWith('edit') || c.id.startsWith('add'))).toBe(false);
    sendWsSpy.mockRestore();
  });

  it('shows the player list and an add field when team randomization is enabled', async () => {
    renderHomeScreen();
    expect(await screen.findByLabelText('Name hinzufügen')).toBeInTheDocument();
    expect(screen.getByText('Noch keine Spieler')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Name 1, Name 2, ...')).not.toBeInTheDocument();
  });

  it('draws the configured gameshow roster on load and lists it alphabetically', async () => {
    mockedFetchSettings.mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      globalRules: ['Rule 1'],
      players: ['Charlie', 'Alice', 'Bob'],
    });
    renderHomeScreen();
    await waitFor(() => {
      const names = Array.from(document.querySelectorAll('.draw-pool-label')).map(n => n.textContent);
      expect(names).toEqual(['Alice', 'Bob', 'Charlie']);
    });
    expect(screen.getByText('3 Spieler · die Teams werden gleich ausgelost')).toBeInTheDocument();
    expect(document.querySelector('#teams')).toBeNull();
  });

  it('gives the gamemaster an add field and "Teams zuweisen" but no "Weiter" before the reveal', async () => {
    mockedFetchSettings.mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      globalRules: ['Rule 1'],
      players: ['Alice', 'Bob', 'Charlie'],
    });
    const sendWsSpy = vi.spyOn(backendSocket, 'sendWs');
    renderHomeScreen();

    type Ctrl = { id: string; type: string; disabled?: boolean };
    type Payload = { controls?: Ctrl[] } | null;
    await waitFor(() => {
      const last = sendWsSpy.mock.calls.filter(([ch]) => ch === 'gamemaster-controls').at(-1);
      const controls = (last?.[1] as Payload)?.controls ?? [];
      expect(controls.find(c => c.id === 'add-player')?.type).toBe('input-group');
      expect(controls.find(c => c.id === 'reveal-teams')?.disabled).toBe(false);
      expect(controls.find(c => c.type === 'nav')).toBeUndefined();
    });
    sendWsSpy.mockRestore();
  });

  it('disables "Teams zuweisen" while nobody is in the draw', async () => {
    renderHomeScreen();
    await screen.findByLabelText('Name hinzufügen');
    expect(screen.getByRole('button', { name: 'Teams zuweisen' })).toBeDisabled();
  });

  it('does not show "Weiter" button when no teams are assigned', async () => {
    renderHomeScreen();
    await screen.findByLabelText('Name hinzufügen');
    expect(screen.queryByText('Weiter')).not.toBeInTheDocument();
  });

  it('assigns teams when names are added and revealed', async () => {
    const user = userEvent.setup();
    renderHomeScreen();
    await addAndReveal(user, 'Alice, Bob, Charlie, Dave');

    await waitFor(() => {
      expect(screen.getByText('Team 1')).toBeInTheDocument();
      expect(screen.getByText('Team 2')).toBeInTheDocument();
    });
    // All names should appear as editable roster inputs (values, not text nodes).
    expect(screen.getByDisplayValue('Alice')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Bob')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Charlie')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Dave')).toBeInTheDocument();
  });

  it('navigates to /rules on click after teams are assigned', async () => {
    const user = userEvent.setup();
    renderHomeScreen();
    await addAndReveal(user, 'Alice, Bob');

    await waitFor(() => {
      expect(screen.getByText('Team 1')).toBeInTheDocument();
    });

    // Click anywhere (except the editable team heading) to advance
    await user.click(screen.getByText('Game Show'));
    expect(mockedNavigate).toHaveBeenCalledWith('/rules');
  });

  it('renames a team by clicking its heading (no navigation)', async () => {
    const user = userEvent.setup();
    renderHomeScreen();
    await addAndReveal(user, 'Alice, Bob');

    await waitFor(() => {
      expect(screen.getByText('Team 1')).toBeInTheDocument();
    });

    // Clicking the heading enters edit mode instead of advancing
    await user.click(screen.getByText('Team 1'));
    expect(mockedNavigate).not.toHaveBeenCalled();

    const editInput = screen.getByLabelText('Name Team 1');
    await user.type(editInput, 'Die Adler{Enter}');

    await waitFor(() => {
      expect(screen.getByText('Die Adler')).toBeInTheDocument();
    });
    expect(mockedNavigate).not.toHaveBeenCalled();
  });

  it('adds players from the gamemaster add field', async () => {
    renderHomeScreen();
    await screen.findByLabelText('Name hinzufügen');

    act(() => {
      __emitChannelForTests('gamemaster-command', {
        controlId: 'add-player',
        value: { name: 'Zoe, Max' },
        timestamp: Date.now() + Math.random(),
      });
    });

    await waitFor(() => {
      const names = Array.from(document.querySelectorAll('.draw-pool-label')).map(n => n.textContent);
      expect(names).toEqual(['Max', 'Zoe']);
    });
  });

  it('capitalizes every word of a multi-word name on assignment', async () => {
    const user = userEvent.setup();
    renderHomeScreen();
    await addAndReveal(user, 'john smith, mary jane');

    await waitFor(() => {
      expect(screen.getByDisplayValue('John Smith')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Mary Jane')).toBeInTheDocument();
    });
  });
});
