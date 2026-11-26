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

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn(),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
}));
const mockedFetchSettings = vi.mocked(fetchSettings);

const mockedNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockedNavigate };
});

const PLAYERS = ['Anna', 'Ben', 'Carla', 'Dora'];

function settings(over: Record<string, unknown> = {}) {
  return {
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
    players: PLAYERS,
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

const roster = (key: string): string[] => JSON.parse(localStorage.getItem(key) ?? '[]');
const allDrawn = (count = 2) =>
  Array.from({ length: count }, (_, i) => roster(`team${i + 1}`)).flat().sort();
const poolNames = () => Array.from(document.querySelectorAll('.draw-pool-label')).map(n => n.textContent);

const gm = (controlId: string, value?: Record<string, string>) => {
  act(() => {
    __emitChannelForTests('gamemaster-command', { controlId, value, timestamp: Date.now() + Math.random() });
  });
};

type Btn = { id: string; label: string; variant?: string; menu?: Btn[] };
type Ctrl = { id: string; type: string; label?: string; buttons?: Btn[]; text?: string; disabled?: boolean; layout?: string; team?: string };
let sendWsSpy: ReturnType<typeof vi.spyOn>;
const lastControls = (): Ctrl[] => {
  const calls = sendWsSpy.mock.calls.filter(([ch]) => ch === 'gamemaster-controls');
  return ((calls.at(-1)?.[1] as { controls?: Ctrl[] } | null)?.controls) ?? [];
};

beforeEach(() => {
  localStorage.clear();
  mockedNavigate.mockClear();
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
    expect(poolNames()).toEqual(PLAYERS); // alphabetical, not in team order
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
      expect(document.querySelector('#team1')!.querySelector(`input[value="${name}"]`)).not.toBeNull();
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
    mockedFetchSettings.mockResolvedValue(settings({ players: ['Anna', 'Ben', 'Carla'] }));
    const user = userEvent.setup();
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(['Anna', 'Ben', 'Carla']));
    const before = { team1: roster('team1'), team2: roster('team2') };
    const smaller = before.team1.length < before.team2.length ? 'team1' : 'team2';
    const other = smaller === 'team1' ? 'team2' : 'team1';

    await user.type(screen.getByLabelText('Name hinzufügen'), 'emil');
    await user.click(screen.getByRole('button', { name: 'Hinzufügen' }));
    await waitFor(() => expect(roster(smaller)).toEqual([...before[smaller], 'Emil']));
    expect(roster(other)).toEqual(before[other]);
    expect((screen.getByLabelText('Name hinzufügen') as HTMLInputElement).value).toBe('');
  });

  it('removes a name with its ✕ and keeps everyone else in place', async () => {
    const user = userEvent.setup();
    renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    const before = { team1: roster('team1'), team2: roster('team2') };
    await user.click(screen.getByRole('button', { name: 'Dora entfernen' }));
    await waitFor(() => expect(allDrawn()).toEqual(['Anna', 'Ben', 'Carla']));
    expect(roster('team1')).toEqual(before.team1.filter(n => n !== 'Dora'));
    expect(roster('team2')).toEqual(before.team2.filter(n => n !== 'Dora'));
  });

  it('keeps the draw across a reload and does not bring back a removed player', async () => {
    const user = userEvent.setup();
    const first = renderHomeScreen();
    await waitFor(() => expect(allDrawn()).toEqual(PLAYERS));
    await user.click(screen.getByRole('button', { name: 'Dora entfernen' }));
    await waitFor(() => expect(allDrawn()).toEqual(['Anna', 'Ben', 'Carla']));
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
      expect(players.map(b => b.label).sort()).toEqual(PLAYERS);
    });
    const controls = lastControls();
    const team1 = controls.find(c => c.id === 'draw-team1')!;
    // A card per team, equal-width cells, names alphabetical; ids keep the roster index.
    expect(team1.layout).toBe('grid');
    expect(team1.team).toBe('team1');
    const labels = team1.buttons!.map(b => b.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'de')));
    const first = team1.buttons!.find(b => b.id === 'player-team1-0')!;
    expect(first.label).toBe(roster('team1')[0]);
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
    mockedFetchSettings.mockResolvedValue(settings({ teamCount: 3, players: ['Anna', 'Ben', 'Carla', 'Dora', 'Emil', 'Fritz'] }));
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
    localStorage.setItem('team1', JSON.stringify(['Anna', 'Ben']));
    localStorage.setItem('team2', JSON.stringify(['Carla']));
    localStorage.setItem('teamsRevealed', 'true');
    renderHomeScreen();
    await waitFor(() => expect(document.querySelector('#teams')).not.toBeNull());
    gm('add-player', { name: 'dora' });
    await waitFor(() => expect(roster('team2')).toEqual(['Carla', 'Dora']));
    expect(localStorage.getItem('teamsRevealed')).toBe('true');
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
    // slot), team cards, then rename + "Weiter" at the bottom.
    const ids = lastControls().map(c => c.id);
    expect(ids.slice(0, 3)).toEqual(['hide-teams', 'reshuffle-teams', 'add-player']);
    expect(ids.indexOf('draw-team2')).toBeLessThan(ids.indexOf('edit-team'));
    expect(ids.at(-1)).toBe('nav');
    const drawn = { team1: roster('team1'), team2: roster('team2') };

    gm('hide-teams');
    await waitFor(() => expect(document.querySelector('#teams')).toBeNull());
    expect(poolNames()).toEqual(PLAYERS);
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
