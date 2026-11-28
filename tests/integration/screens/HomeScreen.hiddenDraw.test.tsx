// The hidden random draw on the start screen and the GM preview / popover /
// add / reshuffle controls. See specs/team-management.md ("Verdeckte Auslosung").
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import { fetchSettings } from '@/services/api';
import * as backendSocket from '@/services/useBackendSocket';
import { __emitChannelForTests } from '@/services/useBackendSocket';
import { setInactiveShowTab } from '@/services/showPresenceState';
import HomeScreen from '@/components/screens/HomeScreen';
import { fullName, normalizeRoster } from '@/utils/playerNames';
import { player } from '../../_helpers/players';

const mockSyncLivePlayers = vi.hoisted(() => vi.fn().mockResolvedValue({ players: [] }));
vi.mock('@/services/api', () => ({
  syncLivePlayers: (...args: unknown[]) => mockSyncLivePlayers(...args),
  fetchSettings: vi.fn(),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
}));
const mockedFetchSettings = vi.mocked(fetchSettings);

const mockedNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockedNavigate };
});

// The configured players come from the registry (full names); the show labels
// them by nickname (= first name here), since every one of them is unique.
const REGISTRY = [
  player('Anna', 'Arndt'), player('Ben', 'Bauer'), player('Carla', 'Conrad'),
  player('Dora', 'Dietz'), player('Emil', 'Eder'), player('Fritz', 'Fuchs'),
];
/** Full names of the first four configured players, alphabetical. */
const PLAYERS = REGISTRY.slice(0, 4).map(fullName);
const FIRST_NAMES = ['Anna', 'Ben', 'Carla', 'Dora'];
const firstOf = (name: string) => name.split(' ')[0]!;

function settings(over: Record<string, unknown> = {}) {
  return {
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
    players: REGISTRY.slice(0, 4),
    ...over,
  };
}

function renderHomeScreen() {
  return render(
    <BrowserRouter>
      <GameProvider>
        <MusicProvider>
          <HomeScreen />
        </MusicProvider>
      </GameProvider>
    </BrowserRouter>,
  );
}

/** A persisted roster as full names (legacy string entries are converted the same way the app does). */
const roster = (key: string): string[] => normalizeRoster(JSON.parse(localStorage.getItem(key) ?? '[]')).map(fullName);
const allDrawn = (count = 2) =>
  Array.from({ length: count }, (_, i) => roster(`team${i + 1}`)).flat().sort();
const poolNames = () => Array.from(document.querySelectorAll('.draw-pool-label')).map(n => n.textContent);

const gm = (controlId: string, value?: Record<string, string>) => {
  act(() => {
    __emitChannelForTests('gamemaster-command', { controlId, value, timestamp: Date.now() + Math.random() });
  });
};

type Btn = { id: string; label: string; variant?: string; menu?: Btn[] };
type Ctrl = { id: string; type: string; label?: string; buttons?: Btn[]; text?: string; disabled?: boolean; layout?: string; team?: string; rename?: Record<string, string> };
let sendWsSpy: ReturnType<typeof vi.spyOn>;
const lastControls = (): Ctrl[] => {
  const calls = sendWsSpy.mock.calls.filter(([ch]) => ch === 'gamemaster-controls');
  return ((calls.at(-1)?.[1] as { controls?: Ctrl[] } | null)?.controls) ?? [];
};

beforeEach(() => {
  localStorage.clear();
  mockedNavigate.mockClear();
  mockSyncLivePlayers.mockReset();
  mockSyncLivePlayers.mockResolvedValue({ players: [] });
  mockedFetchSettings.mockResolvedValue(settings());
  sendWsSpy = vi.spyOn(backendSocket, 'sendWs');
});

afterEach(() => {
  sendWsSpy.mockRestore();
  vi.restoreAllMocks();
  setInactiveShowTab(false);
});

describe('hidden draw on the show', () => {
  it('draws the configured players on load but keeps the teams off the show', async () => {
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    expect(roster('team1')).toHaveLength(2);
    expect(document.querySelector('#teams')).toBeNull();
    expect(poolNames()).toEqual(FIRST_NAMES); // alphabetical, not in team order
    expect(localStorage.getItem('teamsRevealed')).toBe('false');
  });

  it('"Teams zuweisen" reveals exactly the drawn teams', async () => {
    const user = userEvent.setup();
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    const team1 = roster('team1');
    await user.click(screen.getByRole('button', { name: 'Teams zuweisen' }));
    await waitFor(() => expect(document.querySelector('#teams')).not.toBeNull());
    expect(roster('team1')).toEqual(team1);
    for (const name of team1) {
      expect(document.querySelector('#team1')!.querySelector(`input[value="${firstOf(name)}"]`)).not.toBeNull();
    }
  });

  it('a click on "Teams zuweisen" does not also advance the show', async () => {
    // The reveal makes the screen advanceable; the click must not bubble on to
    // the window "click to continue" listener that gets attached meanwhile.
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    const bubbled = vi.fn();
    window.addEventListener('click', bubbled);
    screen.getByRole('button', { name: 'Teams zuweisen' }).click();
    window.removeEventListener('click', bubbled);
    expect(bubbled).not.toHaveBeenCalled();
    await waitFor(() => expect(document.querySelector('#teams')).not.toBeNull());
    expect(mockedNavigate).not.toHaveBeenCalled();
  });

  it('adds a name to the smaller team without moving anyone', async () => {
    mockedFetchSettings.mockResolvedValue(settings({ players: REGISTRY.slice(0, 3) }));
    const user = userEvent.setup();
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS.slice(0, 3)));
    const before = { team1: roster('team1'), team2: roster('team2') };
    const smaller = before.team1.length < before.team2.length ? 'team1' : 'team2';
    const other = smaller === 'team1' ? 'team2' : 'team1';

    await user.type(screen.getByLabelText('Name hinzufügen'), 'emil');
    await user.click(screen.getByRole('button', { name: 'Hinzufügen' }));
    // A new name is added as written, as the nickname.
    await waitFor(() => expect(roster(smaller)).toEqual([...before[smaller], 'emil']));
    expect(roster(other)).toEqual(before[other]);
    expect((screen.getByLabelText('Name hinzufügen') as HTMLInputElement).value).toBe('');
    // …and goes into the active gameshow as a nickname-only registry player.
    expect(mockSyncLivePlayers).toHaveBeenCalledWith({ add: [{ firstName: '', lastName: '', nickname: 'emil' }] });
  });

  it('suggests registry players while typing; a pick fills the name in, the next Enter adds them', async () => {
    mockedFetchSettings.mockResolvedValue(settings({ registry: REGISTRY }));
    const user = userEvent.setup();
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    const input = screen.getByLabelText('Name hinzufügen');
    await user.type(input, 'e');
    // Only players not in the draw yet: Ben Bauer and Dora Dietz match "e" too, but are drawn.
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Emil Eder']);
    await user.keyboard('{ArrowDown}{Enter}');
    // The first Enter only fills the name in.
    expect(input).toHaveValue('Emil Eder');
    expect(input).toHaveFocus();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(allDrawn()).toEqual(PLAYERS);
    expect(mockSyncLivePlayers).not.toHaveBeenCalled();
    // The second one adds the registry player.
    await user.keyboard('{Enter}');
    await waitFor(() => expect(allDrawn()).toEqual([...PLAYERS, 'Emil Eder'].sort()));
    expect(poolNames()).toContain('Emil');
    expect(input).toHaveValue('');
    expect(mockSyncLivePlayers).toHaveBeenCalledWith({ add: [{ id: 'emil-eder' }] });
  });

  it('a tap fills the name in after the names typed before it; "Hinzufügen" adds them all', async () => {
    mockedFetchSettings.mockResolvedValue(settings({ registry: REGISTRY }));
    const user = userEvent.setup();
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    const input = screen.getByLabelText('Name hinzufügen');
    await user.type(input, 'Zoe, fr');
    await user.click(screen.getByRole('option', { name: 'Fritz Fuchs' }));
    expect(input).toHaveValue('Zoe, Fritz Fuchs');
    expect(allDrawn()).toEqual(PLAYERS);
    await user.click(screen.getByRole('button', { name: 'Hinzufügen' }));
    await waitFor(() => expect(allDrawn()).toEqual([...PLAYERS, 'Fritz Fuchs', 'Zoe'].sort()));
    expect(mockSyncLivePlayers).toHaveBeenCalledWith({
      add: [{ firstName: '', lastName: '', nickname: 'Zoe' }, { id: 'fritz-fuchs' }],
    });
  });

  it('a picked label with a nickname resolves to that player', async () => {
    const maus = player('Marlene', 'Auer', 'marlene-auer', 'Maus');
    mockedFetchSettings.mockResolvedValue(settings({ registry: [...REGISTRY, maus] }));
    const user = userEvent.setup();
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    const input = screen.getByLabelText('Name hinzufügen');
    await user.type(input, 'mau');
    await user.click(screen.getByRole('option', { name: 'Marlene „Maus“ Auer' }));
    expect(input).toHaveValue('Marlene „Maus“ Auer');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(poolNames()).toContain('Maus'));
    expect(mockSyncLivePlayers).toHaveBeenCalledWith({ add: [{ id: 'marlene-auer' }] });
  });

  it('does not suggest a disabled player until one of their names is typed in full', async () => {
    const off = REGISTRY.map(p => (p.id === 'emil-eder' ? { ...p, disabled: true } : p));
    mockedFetchSettings.mockResolvedValue(settings({ registry: off }));
    const user = userEvent.setup();
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    const input = screen.getByLabelText('Name hinzufügen');
    await user.type(input, 'emi');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    await user.type(input, 'l');
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Emil Eder']);
  });

  it('ArrowDown in the empty add field lists every registry player not drawn yet', async () => {
    mockedFetchSettings.mockResolvedValue(settings({ registry: REGISTRY }));
    const user = userEvent.setup();
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    await user.click(screen.getByLabelText('Name hinzufügen'));
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Emil Eder', 'Fritz Fuchs']);
    expect(mockedNavigate).not.toHaveBeenCalled();
  });

  it('a second click into the add field lists every registry player not drawn yet', async () => {
    mockedFetchSettings.mockResolvedValue(settings({ registry: REGISTRY }));
    const user = userEvent.setup();
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    const input = screen.getByLabelText('Name hinzufügen');
    await user.click(input);
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    await user.click(input);
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Emil Eder', 'Fritz Fuchs']);
    expect(mockedNavigate).not.toHaveBeenCalled();
  });

  it('suggests a deleted (binned) player for a full name and adds them by id, which restores them', async () => {
    const gerd = player('Gerd', 'Gone', 'gerd-gone', 'Gerdi');
    mockedFetchSettings.mockResolvedValue(settings({ registry: REGISTRY, binned: [gerd] }));
    const user = userEvent.setup();
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    const input = screen.getByLabelText('Name hinzufügen');
    await user.type(input, 'ger');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    await user.type(input, 'di');
    await user.click(screen.getByRole('option', { name: 'Gerd „Gerdi“ Gone' }));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(poolNames()).toContain('Gerdi'));
    expect(mockSyncLivePlayers).toHaveBeenCalledWith({ add: [{ id: 'gerd-gone' }] });
  });

  it('Enter without a highlighted suggestion adds the typed text, Escape closes the list', async () => {
    mockedFetchSettings.mockResolvedValue(settings({ registry: REGISTRY }));
    const user = userEvent.setup();
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    const input = screen.getByLabelText('Name hinzufügen');
    await user.type(input, 'Em');
    expect(screen.getByRole('option', { name: 'Emil Eder' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(allDrawn()).toContain('Em'));
    expect(allDrawn()).not.toContain('Emil Eder');
  });

  it('takes a removed player out of the gameshow', async () => {
    const user = userEvent.setup();
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    await user.click(screen.getByRole('button', { name: 'Dora entfernen' }));
    expect(mockSyncLivePlayers).toHaveBeenCalledWith({ remove: ['dora-dietz'] });
  });

  it('gives a live-added name its registry id once the gameshow has it', async () => {
    const user = userEvent.setup();
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    await user.type(screen.getByLabelText('Name hinzufügen'), 'Kiki');
    await user.click(screen.getByRole('button', { name: 'Hinzufügen' }));
    await waitFor(() => expect(allDrawn()).toContain('Kiki'));
    // The server wrote her into the registry and the gameshow; the settings reload brings her back.
    const kiki = { id: 'kiki', firstName: '', lastName: '', nickname: 'Kiki' };
    mockedFetchSettings.mockResolvedValue(settings({ players: [...REGISTRY.slice(0, 4), kiki] }));
    act(() => { __emitChannelForTests('content-changed', { config: true }); });
    await waitFor(() => {
      const all = ['team1', 'team2'].flatMap(k => JSON.parse(localStorage.getItem(k) ?? '[]') as { nickname?: string; id?: string }[]);
      expect(all.filter(p => p.nickname === 'Kiki')).toEqual([kiki]);
    });
    expect(allDrawn()).toEqual([...PLAYERS, 'Kiki'].sort());
  });

  it('does not write the gameshow from an inactive show tab', async () => {
    const user = userEvent.setup();
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    setInactiveShowTab(true);
    await user.click(screen.getByRole('button', { name: 'Dora entfernen' }));
    expect(mockSyncLivePlayers).not.toHaveBeenCalled();
  });

  it('removes a name with its ✕ and keeps everyone else in place', async () => {
    const user = userEvent.setup();
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    const before = { team1: roster('team1'), team2: roster('team2') };
    await user.click(screen.getByRole('button', { name: 'Dora entfernen' }));
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS.slice(0, 3)));
    expect(roster('team1')).toEqual(before.team1.filter(n => n !== 'Dora Dietz'));
    expect(roster('team2')).toEqual(before.team2.filter(n => n !== 'Dora Dietz'));
  });

  it('keeps the draw across a reload and does not bring back a removed player', async () => {
    const user = userEvent.setup();
    const first = renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    await user.click(screen.getByRole('button', { name: 'Dora entfernen' }));
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS.slice(0, 3)));
    const kept = { team1: roster('team1'), team2: roster('team2') };
    first.unmount();

    renderHomeScreen();
    await waitFor(() => expect(poolNames()).toEqual(['Anna', 'Ben', 'Carla']));
    await new Promise(r => setTimeout(r, 50));
    expect({ team1: roster('team1'), team2: roster('team2') }).toEqual(kept);
  });

  it('blocks advancing until the teams are revealed', async () => {
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    gm('nav-forward');
    expect(mockedNavigate).not.toHaveBeenCalled();
    gm('reveal-teams');
    await waitFor(() => expect(document.querySelector('#teams')).not.toBeNull());
    gm('nav-forward');
    expect(mockedNavigate).toHaveBeenCalledWith('/rules');
  });

  it('refuses a player who is already in the draw', async () => {
    const user = userEvent.setup();
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    await user.type(screen.getByLabelText('Name hinzufügen'), 'anna arndt');
    await user.click(screen.getByRole('button', { name: 'Hinzufügen' }));
    expect(await screen.findByRole('status')).toHaveTextContent('„Anna Arndt“ ist schon dabei.');
    expect(allDrawn()).toEqual(PLAYERS);
  });

  it('reads a typed nickname as that configured player, so it is already in the draw', async () => {
    const user = userEvent.setup();
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    await user.type(screen.getByLabelText('Name hinzufügen'), 'anna');
    await user.click(screen.getByRole('button', { name: 'Hinzufügen' }));
    expect(await screen.findByRole('status')).toHaveTextContent('„Anna Arndt“ ist schon dabei.');
    expect(allDrawn()).toEqual(PLAYERS);
  });

  it('refuses a nickname two registry players share and asks to pick from the list', async () => {
    mockedFetchSettings.mockResolvedValue(settings({
      players: [player('Michael', 'Huber', 'mh', 'Michi'), player('Michaela', 'Pichler', 'mp', 'Michi')],
    }));
    const user = userEvent.setup();
    renderHomeScreen();
    await waitFor(() => expect(poolNames()).toEqual(['Michi H.', 'Michi P.']));
    await user.type(screen.getByLabelText('Name hinzufügen'), 'michi');
    await user.click(screen.getByRole('button', { name: 'Hinzufügen' }));
    expect(await screen.findByRole('status')).toHaveTextContent('„michi“ gibt es mehrmals – bitte aus der Liste auswählen.');
    expect(poolNames()).toEqual(['Michi H.', 'Michi P.']);
    expect(mockSyncLivePlayers).not.toHaveBeenCalled();
  });

  it('labels players by nickname', async () => {
    mockedFetchSettings.mockResolvedValue(settings({
      players: [player('Marlene', 'Auer', 'ma', 'Maus'), player('Ben', 'Bauer')],
    }));
    renderHomeScreen();
    await waitFor(() => expect(poolNames()).toEqual(['Ben', 'Maus']));
  });

  it('labels two players with the same first name by their surname', async () => {
    mockedFetchSettings.mockResolvedValue(settings({
      players: [player('Michi', 'Pichler'), player('Anna', 'Arndt'), player('Michi', 'Huber')],
    }));
    renderHomeScreen();
    await waitFor(() => expect(poolNames()).toEqual(['Anna', 'Michi H.', 'Michi P.']));
    // The full name is still there on hover.
    const label = [...document.querySelectorAll('.draw-pool-label')].find(n => n.textContent === 'Michi H.');
    expect(label?.getAttribute('title')).toBe('Michi Huber');
  });

  it('follows a change of the configured players by id', async () => {
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    // Anna renamed, Dora removed, Emil added — via a settings reload (live config reload).
    mockedFetchSettings.mockResolvedValue(settings({
      players: [player('Anna', 'Meier', 'anna-arndt'), REGISTRY[1], REGISTRY[2], REGISTRY[4]],
    }));
    act(() => { __emitChannelForTests('content-changed', { config: true }); });
    await waitFor(() => expect(allDrawn()).toEqual(['Anna Meier', 'Ben Bauer', 'Carla Conrad', 'Emil Eder']));
  });

  it('does not draw in an inactive show tab', async () => {
    setInactiveShowTab(true);
    renderHomeScreen();
    await screen.findByLabelText('Name hinzufügen');
    await new Promise(r => setTimeout(r, 50));
    expect(allDrawn()).toEqual([]);
  });

  describe('measured member columns after the reveal', () => {
    // jsdom has no layout: fake one where a member list sits 200px down and
    // every row of names is 80px tall, so the list's bottom depends on how many
    // columns it currently has; the page is 16px taller than the longest list.
    const ulBottom = (ul: Element) => {
      const cols = Number(ul.getAttribute('data-columns') ?? '1');
      return 200 + Math.ceil(ul.querySelectorAll('li').length / cols) * 80;
    };
    const fakeLayout = (innerHeight: number) => {
      vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(innerHeight);
      vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockImplementation(() =>
        Math.max(innerHeight, Math.max(...[...document.querySelectorAll('ul.team-members')].map(ulBottom)) + 16));
      const real = Element.prototype.getBoundingClientRect;
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        if (this.tagName !== 'UL' || !this.classList.contains('team-members')) return real.call(this);
        const bottom = ulBottom(this);
        return { top: 200, bottom, height: bottom - 200, left: 0, right: 0, width: 0, x: 0, y: 200, toJSON() {} } as DOMRect;
      });
    };
    const seed = (team1: number, team2: number) => {
      const names = Array.from({ length: team1 + team2 }, (_, i) => `Spieler ${i + 1}`);
      localStorage.setItem('team1', JSON.stringify(names.slice(0, team1)));
      localStorage.setItem('team2', JSON.stringify(names.slice(team1)));
      localStorage.setItem('teamsRevealed', 'true');
    };
    const cols = (team: string) => document.querySelector(`#${team} ul`)?.getAttribute('data-columns');

    it('keeps one column while a card fits and adds a column only to the card that does not', async () => {
      fakeLayout(768); // 10 rows → page 1016 scrolls; team 2 (tallest) gets 2 columns → 600 + 16 fits
      seed(5, 10);
      renderHomeScreen();
      await waitFor(() => expect(cols('team2')).toBe('2'));
      expect(cols('team1')).toBe('1');
    });

    it('stays at one column when even a long roster fits the screen', async () => {
      fakeLayout(1200); // 10 rows → page 1016 fits
      seed(5, 10);
      renderHomeScreen();
      await waitFor(() => expect(document.querySelector('#teams')).not.toBeNull());
      expect(cols('team1')).toBe('1');
      expect(cols('team2')).toBe('1');
    });

    it('goes to three columns at two teams when two still do not fit', async () => {
      fakeLayout(768); // 21 rows → 2 cols: 11 rows (1096) scrolls → 3 cols: 7 rows (776) still scrolls → cap 3
      seed(3, 21);
      renderHomeScreen();
      await waitFor(() => expect(cols('team2')).toBe('3'));
      expect(cols('team1')).toBe('1');
    });
  });
});

describe('GM controls', () => {
  it('previews the draw with a move/remove menu per player and no "Weiter"', async () => {
    renderHomeScreen();
    await waitFor(() => expect(lastControls().find(c => c.id === 'draw-preview')).toBeTruthy());
    await waitFor(() => {
      const players = lastControls().filter(c => c.id.startsWith('draw-team')).flatMap(c => c.buttons!);
      expect(players.map(b => b.label).sort()).toEqual(FIRST_NAMES);
    });
    const controls = lastControls();
    const team1 = controls.find(c => c.id === 'draw-team1')!;
    // A card per team, equal-width cells, names alphabetical; ids keep the roster index.
    expect(team1.layout).toBe('grid');
    expect(team1.team).toBe('team1');
    const labels = team1.buttons!.map(b => b.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'de')));
    const first = team1.buttons!.find(b => b.id === 'player-team1-0')!;
    expect(first.label).toBe(firstOf(roster('team1')[0]!));
    expect(first.menu!.map(m => m.id)).toEqual(['mvto-team1-0-team2', 'rm-team1-0']);
    expect(first.menu!.map(m => m.label)).toEqual(['→ Team 2', 'Entfernen']);
    expect(controls.find(c => c.id === 'reveal-teams')?.disabled).toBe(false);
    expect(controls.find(c => c.id === 'add-player')).toBeTruthy();
    expect(controls.find(c => c.type === 'nav')).toBeUndefined();
    // The actions come before the (possibly long) team cards.
    const ids = controls.map(c => c.id);
    expect(ids.slice(0, 4)).toEqual(['draw-preview', 'reveal-teams', 'reshuffle-teams', 'add-player']);
  });

  it('moves a player through the popover command', async () => {
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    const moved = roster('team1')[0]!;
    gm('mvto-team1-0-team2');
    await waitFor(() => expect(roster('team2')).toContain(moved));
    expect(roster('team1')).not.toContain(moved);
    expect(localStorage.getItem('teamsRevealed')).toBe('false');
  });

  it('offers every other team at three teams and moves to the chosen one', async () => {
    mockedFetchSettings.mockResolvedValue(settings({ teamCount: 3, players: REGISTRY }));
    renderHomeScreen();
    await waitFor(() => expect(allDrawn(3)).toHaveLength(6));
    await waitFor(() => {
      const first = lastControls().find(c => c.id === 'draw-team1')?.buttons?.find(b => b.id === 'player-team1-0');
      expect(first?.menu?.map(m => m.id)).toEqual(['mvto-team1-0-team2', 'mvto-team1-0-team3', 'rm-team1-0']);
    });
    const moved = roster('team1')[0]!;
    gm('mvto-team1-0-team3');
    await waitFor(() => expect(roster('team3')).toContain(moved));
    expect(roster('team1')).not.toContain(moved);
  });

  it('removes a player through the popover command', async () => {
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    const removed = roster('team1')[0]!;
    gm('rm-team1-0');
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS.filter(p => p !== removed)));
  });

  it('adds players after the reveal too, keeping the teams on screen', async () => {
    // Rosters from before the update (plain strings) keep working.
    localStorage.setItem('team1', JSON.stringify(['Anna', 'Ben']));
    localStorage.setItem('team2', JSON.stringify(['Carla']));
    localStorage.setItem('teamsRevealed', 'true');
    renderHomeScreen();
    await waitFor(() => expect(document.querySelector('#teams')).not.toBeNull());
    // "dora" is the nickname of the configured Dora Dietz, so she is the one added.
    gm('add-player', { name: 'dora' });
    await waitFor(() => expect(roster('team2')).toEqual(['Carla', 'Dora Dietz']));
    expect(localStorage.getItem('teamsRevealed')).toBe('true');
  });

  it('gives the GM add field the registry players not in the draw; a submitted label adds that player', async () => {
    mockedFetchSettings.mockResolvedValue(settings({ registry: REGISTRY }));
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    type Input = { id: string; suggestions?: { id: string; label: string }[] };
    const addField = () => (lastControls().find(c => c.id === 'add-player') as unknown as { inputs: Input[] } | undefined)?.inputs[0];
    await waitFor(() => expect(addField()?.suggestions).toEqual([
      { id: 'emil-eder', label: 'Emil Eder' },
      { id: 'fritz-fuchs', label: 'Fritz Fuchs' },
    ]));
    // The GM empties the field after each add.
    expect(lastControls().find(c => c.id === 'add-player')).toMatchObject({ clearOnSubmit: true });
    // The GM filled a pick in after a typed name, then submitted.
    gm('add-player', { name: 'Zoe, Emil Eder' });
    await waitFor(() => expect(allDrawn()).toEqual([...PLAYERS, 'Emil Eder', 'Zoe'].sort()));
    expect(mockSyncLivePlayers).toHaveBeenCalledWith({
      add: [{ firstName: '', lastName: '', nickname: 'Zoe' }, { id: 'emil-eder' }],
    });
    // Emil is drawn now: no longer suggested.
    await waitFor(() => expect(addField()?.suggestions).toEqual([{ id: 'fritz-fuchs', label: 'Fritz Fuchs' }]));
  });

  it('titles each player\'s GM menu with the full name, the button keeps the short label', async () => {
    mockedFetchSettings.mockResolvedValue(settings({
      players: [player('Michael', 'Huber', 'mh', 'Michi'), player('Michaela', 'Pichler', 'mp', 'Michi')],
    }));
    renderHomeScreen();
    type MenuBtn = Btn & { menuTitle?: string };
    const buttons = () => lastControls().filter(c => c.id.startsWith('draw-')).flatMap(c => (c.buttons ?? []) as MenuBtn[]);
    await waitFor(() => expect(buttons()).toHaveLength(2));
    expect(buttons().map(b => [b.label, b.menuTitle]).sort()).toEqual([
      ['Michi H.', 'Michael „Michi“ Huber'],
      ['Michi P.', 'Michaela „Michi“ Pichler'],
    ]);
  });

  it('takes a player the GM removes out of the gameshow', async () => {
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    const team1 = normalizeRoster(JSON.parse(localStorage.getItem('team1') ?? '[]'));
    gm(`rm-team1-0`);
    await waitFor(() => expect(roster('team1')).toHaveLength(team1.length - 1));
    expect(mockSyncLivePlayers).toHaveBeenCalledWith({ remove: [team1[0]!.id] });
  });

  it('"Zuweisung verbergen" sends the show back to its first screen and keeps the draw', async () => {
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    // Not offered while the teams are still hidden.
    await waitFor(() => expect(lastControls().find(c => c.id === 'draw-preview')).toBeTruthy());
    expect(lastControls().find(c => c.id === 'hide-teams')).toBeUndefined();

    gm('reveal-teams');
    await waitFor(() => expect(document.querySelector('#teams')).not.toBeNull());
    await waitFor(() => expect(lastControls().find(c => c.id === 'hide-teams')).toBeTruthy());
    // Same layout as before the reveal: actions on top (hide in the reveal's
    // slot), team cards, then "Weiter" at the bottom. The rename is on the cards.
    const ids = lastControls().map(c => c.id);
    expect(ids.slice(0, 3)).toEqual(['hide-teams', 'reshuffle-teams', 'add-player']);
    expect(ids).not.toContain('edit-team');
    expect(ids.at(-1)).toBe('nav');
    const drawn = { team1: roster('team1'), team2: roster('team2') };

    gm('hide-teams');
    await waitFor(() => expect(document.querySelector('#teams')).toBeNull());
    expect(poolNames()).toEqual(FIRST_NAMES);
    expect(localStorage.getItem('teamsRevealed')).toBe('false');
    expect({ team1: roster('team1'), team2: roster('team2') }).toEqual(drawn);
    // Advancing is blocked again, and the GM is back on the preview controls.
    gm('nav-forward');
    expect(mockedNavigate).not.toHaveBeenCalled();
    await waitFor(() => expect(lastControls().find(c => c.id === 'draw-preview')).toBeTruthy());

    // Revealing again brings back exactly the same teams.
    gm('reveal-teams');
    await waitFor(() => expect(document.querySelector('#teams')).not.toBeNull());
    expect({ team1: roster('team1'), team2: roster('team2') }).toEqual(drawn);
  });

  it('renames a team from its GM card after the reveal, not before', async () => {
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    await waitFor(() => expect(lastControls().find(c => c.id === 'draw-preview')).toBeTruthy());
    // Hidden draw: the card names are plain labels.
    expect(lastControls().find(c => c.id === 'draw-team1')?.rename).toBeUndefined();

    gm('reveal-teams');
    await waitFor(() => expect(lastControls().find(c => c.id === 'draw-team1')?.rename).toEqual({
      id: 'team-name-team1',
      value: '',
      placeholder: 'Team 1',
      ariaLabel: 'Name Team 1',
    }));
    gm('team-name-team1:change', { name: 'Füchse' });
    gm('team-name-team1', { name: 'Füchse' });
    await waitFor(() => expect(document.querySelector('#team1')?.textContent).toContain('Füchse'));
    expect(localStorage.getItem('team1Name')).toBe('Füchse');
    await waitFor(() => {
      const team1 = lastControls().find(c => c.id === 'draw-team1')!;
      expect(team1.label).toMatch(/^Füchse \(\d+\)$/);
      expect(team1.rename?.value).toBe('Füchse');
    });
  });

  it('"Neu mischen" redraws the same players without revealing', async () => {
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    gm('reshuffle-teams');
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(allDrawn()).toEqual(PLAYERS);
    expect(localStorage.getItem('teamsRevealed')).toBe('false');
  });

  it('"Neu mischen" also works after the reveal, updating the show live', async () => {
    localStorage.setItem('team1', JSON.stringify(['Anna', 'Ben']));
    localStorage.setItem('team2', JSON.stringify(['Carla', 'Dora']));
    localStorage.setItem('teamsRevealed', 'true');
    renderHomeScreen();
    await waitFor(() => expect(document.querySelector('#teams')).not.toBeNull());
    await waitFor(() => expect(lastControls().find(c => c.id === 'reshuffle-teams')).toBeTruthy());
    vi.spyOn(Math, 'random').mockReturnValue(0);
    gm('reshuffle-teams');
    // Fisher-Yates with random() = 0 turns [Anna, Ben, Carla, Dora] into
    // [Ben, Carla, Dora, Anna]; round-robin then deals:
    await waitFor(() => expect(roster('team1')).toEqual(['Ben', 'Dora']));
    expect(roster('team2')).toEqual(['Carla', 'Anna']);
    expect(document.querySelector('#team1 input[value="Dora"]')).not.toBeNull();
    expect(localStorage.getItem('teamsRevealed')).toBe('true');
  });
});
