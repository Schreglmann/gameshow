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

  it('shows team assignment form when team randomization is enabled', async () => {
    renderHomeScreen();
    await waitFor(() => {
      expect(
        screen.getByText('Namen eingeben, um sie den Teams zuzuweisen:')
      ).toBeInTheDocument();
    });
  });

  it('prefills the randomization textarea with the configured gameshow roster', async () => {
    mockedFetchSettings.mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      globalRules: ['Rule 1'],
      players: ['Alice', 'Bob', 'Charlie'],
    });
    renderHomeScreen();

    const textarea = await screen.findByPlaceholderText('Name 1, Name 2, ...');
    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe('Alice, Bob, Charlie');
    });
  });

  it('mirrors the prefilled roster to the gamemaster assign-teams control', async () => {
    mockedFetchSettings.mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      globalRules: ['Rule 1'],
      players: ['Alice', 'Bob', 'Charlie'],
    });
    const sendWsSpy = vi.spyOn(backendSocket, 'sendWs');
    renderHomeScreen();

    type Input = { id: string; value?: string };
    type Ctrl = { id: string; inputs?: Input[] };
    type Payload = { controls?: Ctrl[] } | null;
    // The roster loads async from /api/settings, so the value arrives on a later
    // broadcast than the control's first emit — poll until it lands.
    await waitFor(() => {
      const assignControls = sendWsSpy.mock.calls
        .filter(([ch]) => ch === 'gamemaster-controls')
        .map(([, d]) => (d as Payload)?.controls?.find(c => c.id === 'assign-teams'))
        .filter((c): c is Ctrl => Boolean(c));
      expect(assignControls.length).toBeGreaterThan(0);
      const namesInput = assignControls.at(-1)!.inputs?.find(i => i.id === 'names');
      expect(namesInput?.value).toBe('Alice, Bob, Charlie');
    });
    sendWsSpy.mockRestore();
  });

  it('leaves the textarea blank when the gameshow has no configured roster', async () => {
    renderHomeScreen();

    const textarea = await screen.findByPlaceholderText('Name 1, Name 2, ...');
    // settings have loaded (globalRules applied) but no roster → still empty
    await waitFor(() => expect(screen.getByText('Teams zuweisen')).toBeInTheDocument());
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });

  it('does not show "Weiter" button when no teams are assigned', async () => {
    renderHomeScreen();
    await waitFor(() => {
      expect(
        screen.getByText('Namen eingeben, um sie den Teams zuzuweisen:')
      ).toBeInTheDocument();
    });
    // Weiter should not be visible without teams
    expect(screen.queryByText('Weiter')).not.toBeInTheDocument();
  });

  it('assigns teams when names are submitted', async () => {
    const user = userEvent.setup();
    renderHomeScreen();

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Name 1, Name 2, ...')).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText('Name 1, Name 2, ...');
    await user.type(textarea, 'Alice, Bob, Charlie, Dave');
    await user.click(screen.getByText('Teams zuweisen'));

    // Teams should be displayed
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

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Name 1, Name 2, ...')).toBeInTheDocument();
    });

    await user.type(
      screen.getByPlaceholderText('Name 1, Name 2, ...'),
      'Alice, Bob'
    );
    await user.click(screen.getByText('Teams zuweisen'));

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

    const input = await screen.findByPlaceholderText('Name 1, Name 2, ...');
    await user.type(input, 'Alice, Bob');
    await user.click(screen.getByText('Teams zuweisen'));

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

  it('reflects a gamemaster edit of the roster field in the show textarea', async () => {
    renderHomeScreen();
    const textarea = await screen.findByPlaceholderText('Name 1, Name 2, ...');
    expect((textarea as HTMLTextAreaElement).value).toBe('');

    // Simulate the GM typing in its "Namen" field (emitOnChange → assign-teams:change).
    act(() => {
      __emitChannelForTests('gamemaster-command', {
        controlId: 'assign-teams:change',
        value: { names: 'Zoe, Max' },
        timestamp: Date.now() + Math.random(),
      });
    });

    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe('Zoe, Max');
    });
  });

  it('capitalizes every word of a multi-word name on assignment', async () => {
    const user = userEvent.setup();
    renderHomeScreen();

    const textarea = await screen.findByPlaceholderText('Name 1, Name 2, ...');
    await user.type(textarea, 'john smith, mary jane');
    await user.click(screen.getByText('Teams zuweisen'));

    await waitFor(() => {
      expect(screen.getByDisplayValue('John Smith')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Mary Jane')).toBeInTheDocument();
    });
  });
});
