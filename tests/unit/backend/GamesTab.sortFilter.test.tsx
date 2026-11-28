import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GamesTab, { resetGamesListPrefs } from '@/components/backend/GamesTab';
import { GameProvider } from '@/context/GameContext';
import type { GameFileSummary, GameshowConfig } from '@/types/config';

// Sort + Neu/Ungespielt status filter of the Spiele tab. See specs/admin-games-list.md.

const mockFetchGames = vi.fn();
const mockFetchConfig = vi.fn();

vi.mock('@/services/backendApi', () => ({
  fetchGames: (...args: unknown[]) => mockFetchGames(...args),
  fetchConfig: (...args: unknown[]) => mockFetchConfig(...args),
  fetchGame: vi.fn(),
  createGame: vi.fn(),
  createExampleGames: vi.fn(),
  deleteGame: vi.fn(),
  saveGame: vi.fn(),
  saveGameBeacon: vi.fn(),
  fetchAssets: vi.fn().mockResolvedValue({ files: [], subfolders: [] }),
}));

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
    isCleanInstall: false,
  }),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
}));

const DAY = 86_400_000;
// Titles sort Alpha < Beta < Gamma; dates deliberately in a different order.
const games: GameFileSummary[] = [
  { fileName: 'gamma', type: 'simple-quiz', title: 'Gamma', instances: [], isSingleInstance: true, modifiedAt: 5 * DAY, createdAt: 1 * DAY },
  { fileName: 'alpha', type: 'simple-quiz', title: 'Alpha', instances: [], isSingleInstance: true, modifiedAt: 1 * DAY, createdAt: 3 * DAY },
  { fileName: 'beta', type: 'simple-quiz', title: 'Beta', instances: [], isSingleInstance: true, modifiedAt: 3 * DAY, createdAt: 2 * DAY },
];

const show = (name: string, players: string[], gameOrder: string[]): GameshowConfig =>
  ({ name, players, gameOrder }) as GameshowConfig;

// past (played by anna) → active (anna). alpha: Gespielt, beta: Ungespielt (played by bob only), gamma: Neu.
const config = {
  activeGameshow: 'now',
  gameshows: {
    past1: show('Früher 1', ['anna'], ['alpha']),
    past2: show('Früher 2', ['bob'], ['beta']),
    now: show('Jetzt', ['anna'], []),
  },
};

function renderTab() {
  return render(
    <GameProvider>
      <GamesTab onGoToAssets={vi.fn()} onNavigate={vi.fn()} />
    </GameProvider>,
  );
}

function rowTitles(): string[] {
  return Array.from(document.querySelectorAll('.games-list-row .games-list-title')).map(el => el.textContent ?? '');
}

const menuButton = () => screen.getByRole('button', { name: /Sortierung und Filter/ });

/** Open the sort + filter popover (if closed) and click one entry. */
async function pick(name: string) {
  if (!screen.queryByRole('menu')) await userEvent.click(menuButton());
  const item = Array.from(screen.getByRole('menu').querySelectorAll<HTMLElement>('[role^="menuitem"]'))
    .find(el => (el.textContent ?? '').replace(/[↑↓✓]/g, '').trim() === name);
  if (!item) throw new Error(`no menu entry "${name}"`);
  await userEvent.click(item);
}

describe('GamesTab sort + status filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetGamesListPrefs();
    mockFetchGames.mockResolvedValue(games);
    mockFetchConfig.mockResolvedValue(config);
  });

  it('sorts by name by default', async () => {
    renderTab();
    await screen.findByText('Alpha');
    expect(rowTitles()).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(menuButton()).toHaveTextContent('Name ↓');
  });

  it('sorts by type label, then title', async () => {
    mockFetchGames.mockResolvedValue([
      ...games,
      { fileName: 'delta', type: 'bandle', title: 'Delta', instances: [], isSingleInstance: true },
    ]);
    renderTab();
    await screen.findByText('Delta');
    await pick('Typ');
    // "Bandle" sorts before "Klassisches Quiz".
    expect(rowTitles()).toEqual(['Delta', 'Alpha', 'Beta', 'Gamma']);
    expect(menuButton()).toHaveTextContent('Typ ↓');
  });

  it('sorts by clicking a column heading; clicking it again reverses', async () => {
    renderTab();
    await screen.findByText('Alpha');
    await waitFor(() => expect(document.querySelector('.games-col-status')).not.toBeNull());
    const heading = (name: string) =>
      within(document.querySelector('.games-list-header') as HTMLElement).getByRole('button', { name: new RegExp(`^${name}`) });

    await userEvent.click(heading('Status'));
    expect(rowTitles()).toEqual(['Gamma', 'Beta', 'Alpha']);
    expect(menuButton()).toHaveTextContent('Status ↓');
    expect(heading('Status')).toHaveTextContent('Status ↓');

    await userEvent.click(heading('Status'));
    expect(rowTitles()).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(heading('Status')).toHaveTextContent('Status ↑');

    await userEvent.click(heading('Titel'));
    expect(menuButton()).toHaveTextContent('Name ↓');
    expect(heading('Titel')).toHaveTextContent('Titel ↓');
  });

  it('the date heading reverses its date sort', async () => {
    renderTab();
    await screen.findByText('Alpha');
    await pick('Geändert');
    // The popover is still open from pick(); close it, then click the heading.
    await userEvent.click(document.querySelector('.asset-sort-backdrop') as HTMLElement);
    await userEvent.click(within(document.querySelector('.games-list-header') as HTMLElement).getByRole('button', { name: /^Geändert/ }));
    expect(rowTitles()).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(menuButton()).toHaveTextContent('Geändert ↑');
  });

  it('shows the date column only under a date sort', async () => {
    renderTab();
    await screen.findByText('Alpha');
    expect(document.querySelector('.games-col-date')).toBeNull();
    await pick('Geändert');
    expect(document.querySelector('.games-list-header .games-col-date')).toHaveTextContent('Geändert');
    await pick('Name');
    expect(document.querySelector('.games-col-date')).toBeNull();
  });

  it('sorts by last modified, newest first', async () => {
    renderTab();
    await screen.findByText('Alpha');
    await pick('Geändert');
    expect(rowTitles()).toEqual(['Gamma', 'Beta', 'Alpha']);
  });

  it('clicking the active sort again reverses it', async () => {
    renderTab();
    await screen.findByText('Alpha');
    await pick('Geändert');
    await pick('Geändert');
    expect(rowTitles()).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(menuButton()).toHaveTextContent('Geändert ↑');
  });

  it('sorts by created, newest first, and shows the created date column', async () => {
    renderTab();
    await screen.findByText('Alpha');
    await pick('Erstellt');
    expect(rowTitles()).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(document.querySelector('.games-list-header .games-col-date')).toHaveTextContent('Erstellt');
  });

  it('shows the status badge against the active gameshow', async () => {
    renderTab();
    await screen.findByText('Alpha');
    const row = (title: string) => screen.getByText(title).closest('.games-list-row') as HTMLElement;
    await waitFor(() => expect(within(row('Gamma')).getByText('Neu')).toBeInTheDocument());
    expect(within(row('Beta')).getByText('Ungespielt')).toBeInTheDocument();
    expect(within(row('Alpha')).getByText('Gespielt')).toBeInTheDocument();
  });

  it('sorts by status: Neu, Ungespielt, Gespielt', async () => {
    renderTab();
    await screen.findByText('Alpha');
    await waitFor(() => expect(document.querySelector('.games-col-status')).not.toBeNull());
    await pick('Status');
    expect(rowTitles()).toEqual(['Gamma', 'Beta', 'Alpha']);
  });

  it('filters by status; Neu and Ungespielt combine', async () => {
    renderTab();
    await screen.findByText('Alpha');
    await waitFor(() => expect(document.querySelector('.games-col-status')).not.toBeNull());
    await pick('Neu');
    expect(rowTitles()).toEqual(['Gamma']);
    expect(menuButton()).toHaveTextContent('Name ↓ · Neu');
    await pick('Ungespielt');
    expect(rowTitles()).toEqual(['Beta', 'Gamma']);
    expect(menuButton()).toHaveTextContent('Name ↓ · Neu + Ungespielt');
    await pick('Neu');
    expect(rowTitles()).toEqual(['Beta']);
    await pick('Ungespielt');
    expect(rowTitles()).toEqual(['Alpha', 'Beta', 'Gamma']);
    await pick('Gespielt');
    expect(rowTitles()).toEqual(['Alpha']);
    expect(menuButton()).toHaveTextContent('Name ↓ · Gespielt');
    await pick('Gespielt');
    expect(menuButton()).toHaveTextContent(/^Name ↓$/);
  });

  it('offers every status that can occur here, without Eingeplant', async () => {
    renderTab();
    await screen.findByText('Alpha');
    await waitFor(() => expect(document.querySelector('.games-col-status')).not.toBeNull());
    await userEvent.click(menuButton());
    const labels = Array.from(screen.getByRole('menu').querySelectorAll('[role="menuitemcheckbox"]'))
      .map(el => (el.textContent ?? '').replace('✓', '').trim());
    expect(labels).toEqual(['Neu', 'Ungespielt', 'Gemischt', 'Gespielt']);
  });

  it('keeps sort and filter when the tab is unmounted and mounted again (tab switch)', async () => {
    const first = renderTab();
    await screen.findByText('Alpha');
    await waitFor(() => expect(document.querySelector('.games-col-status')).not.toBeNull());
    await pick('Geändert');
    await pick('Ungespielt');
    first.unmount();

    renderTab();
    await screen.findByText('Beta');
    await waitFor(() => expect(rowTitles()).toEqual(['Beta']));
    expect(menuButton()).toHaveTextContent('Geändert ↓ · Ungespielt');
  });

  it('hides the status filter and status sort without an active gameshow', async () => {
    mockFetchConfig.mockResolvedValue({ activeGameshow: 'missing', gameshows: {} });
    renderTab();
    await screen.findByText('Alpha');
    await userEvent.click(menuButton());
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('Sortierung')).toBeInTheDocument();
    expect(within(menu).queryByText('Status')).not.toBeInTheDocument();
    expect(within(menu).queryByText('Filter')).not.toBeInTheDocument();
  });
});
