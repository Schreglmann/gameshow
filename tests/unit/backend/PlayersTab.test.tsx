import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@/context/ThemeContext';
import { ConfirmProvider } from '@/components/backend/ConfirmContext';
import PlayersTab from '@/components/backend/PlayersTab';
import { PlayerLightboxHost } from '@/components/backend/PlayerLightbox';
import { openPlayer } from '@/components/backend/openPlayer';
import { __emitChannelForTests } from '@/services/useBackendSocket';
import type { AppConfig } from '@/types/config';

const mockFetchConfig = vi.fn();
const mockSaveConfig = vi.fn();
const mockFetchGames = vi.fn();

vi.mock('@/services/backendApi', () => ({
  fetchConfig: (...args: unknown[]) => mockFetchConfig(...args),
  saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
  saveConfigBeacon: vi.fn(),
  fetchGames: (...args: unknown[]) => mockFetchGames(...args),
}));

const sampleConfig: AppConfig = {
  pointSystemEnabled: true,
  teamRandomizationEnabled: true,
  globalRules: [],
  activeGameshow: 'gs1',
  players: [
    { id: 'michi-huber', firstName: 'Michi', lastName: 'Huber', nickname: 'Michi' },
    { id: 'anna-mueller', firstName: 'Anna', lastName: 'Müller', nickname: 'Anna' },
    { id: 'ben-weber', firstName: 'Ben', lastName: 'Weber', nickname: 'Benni' },
  ],
  gameshows: {
    gs1: { name: 'Gameshow 1', gameOrder: [], players: ['michi-huber', 'anna-mueller'] },
    gs2: { name: 'Gameshow 2', gameOrder: [], players: ['michi-huber'] },
  },
};

/** PlayersTab plus the lightbox host, as AdminScreen mounts them. */
function renderPlayersTab() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <ConfirmProvider>
          <PlayersTab />
          <PlayerLightboxHost />
        </ConfirmProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

/** The last config handed to saveConfig, after the save queue's debounce. */
async function savedConfig(): Promise<AppConfig> {
  act(() => { vi.advanceTimersByTime(800); });
  await waitFor(() => expect(mockSaveConfig).toHaveBeenCalled());
  return mockSaveConfig.mock.calls.at(-1)![0] as AppConfig;
}

/** The names in the list, in display order (whole names, nickname in quotes). */
function listedNames(): string[] {
  return Array.from(document.querySelectorAll('.players-list-name')).map(n => n.textContent ?? '');
}

/** Open the lightbox of the player with this admin label; returns the names form. */
async function openPage(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('button', { name: `${label} öffnen` }));
  const dialog = await screen.findByRole('dialog', { name: label });
  return dialog.querySelector('.player-lightbox-names') as HTMLElement;
}

/** Open the create popup and fill it in. */
async function fillCreate(user: ReturnType<typeof userEvent.setup>, first: string, last: string, nick = '') {
  await user.click(screen.getByRole('button', { name: '+ Spieler' }));
  const dialog = screen.getByRole('dialog', { name: 'Spieler hinzufügen' });
  if (first) await user.type(within(dialog).getByLabelText('Vorname'), first);
  if (last) await user.type(within(dialog).getByLabelText('Nachname'), last);
  if (nick) await user.type(within(dialog).getByLabelText('Spitzname'), nick);
  return dialog;
}

describe('PlayersTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockFetchConfig.mockResolvedValue(sampleConfig);
    mockSaveConfig.mockResolvedValue(undefined);
    mockFetchGames.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists every registry player as a whole name, sorted, with their gameshow count', async () => {
    renderPlayersTab();
    expect(await screen.findByRole('heading', { name: 'Spieler' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '3 Spieler' })).toBeInTheDocument();
    // The nickname shows only when it differs from the first name.
    expect(listedNames()).toEqual(['Anna Müller', 'Ben „Benni“ Weber', 'Michi Huber']);
    // Read-only: no inputs in the list.
    expect(document.querySelector('.players-list input')).toBeNull();
    const michiRow = screen.getByRole('button', { name: 'Michi Huber öffnen' }).closest('li') as HTMLElement;
    expect(within(michiRow).getByLabelText('2 Gameshows')).toHaveAttribute('title', 'Gameshow 1, Gameshow 2');
  });

  it('puts the cursor in the search field when the tab opens', async () => {
    renderPlayersTab();
    await screen.findByRole('heading', { name: '3 Spieler' });
    expect(screen.getByRole('searchbox', { name: 'Spieler suchen' })).toHaveFocus();
  });

  it('filters by full name and by nickname', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPlayersTab();
    await screen.findByRole('heading', { name: '3 Spieler' });
    await user.type(screen.getByLabelText('Spieler suchen'), 'mül');
    expect(listedNames()).toEqual(['Anna Müller']);
    await user.clear(screen.getByLabelText('Spieler suchen'));
    await user.type(screen.getByLabelText('Spieler suchen'), 'benni');
    expect(listedNames()).toEqual(['Ben „Benni“ Weber']);
    await user.clear(screen.getByLabelText('Spieler suchen'));
    await user.type(screen.getByLabelText('Spieler suchen'), 'zzz');
    expect(screen.getByText('Kein Spieler gefunden.')).toBeInTheDocument();
  });

  it('adds a new player from the popup; an empty nickname is the first name', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPlayersTab();
    await screen.findByRole('heading', { name: '3 Spieler' });
    const dialog = await fillCreate(user, 'Jürgen', 'Groß');
    await user.click(within(dialog).getByRole('button', { name: 'Hinzufügen' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: '4 Spieler' })).toBeInTheDocument();
    const saved = await savedConfig();
    expect(saved.players).toContainEqual({ id: 'juergen-gross', firstName: 'Jürgen', lastName: 'Groß', nickname: 'Jürgen' });
  });

  it('stores a typed nickname', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPlayersTab();
    await screen.findByRole('heading', { name: '3 Spieler' });
    const dialog = await fillCreate(user, 'Marlene', 'Auer', 'Maus');
    await user.click(within(dialog).getByRole('button', { name: 'Hinzufügen' }));
    const saved = await savedConfig();
    expect(saved.players).toContainEqual({ id: 'marlene-auer', firstName: 'Marlene', lastName: 'Auer', nickname: 'Maus' });
  });

  it('keeps the popup open with the error when a name is missing or taken', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPlayersTab();
    await screen.findByRole('heading', { name: '3 Spieler' });
    const dialog = await fillCreate(user, '', 'Graf');
    await user.click(within(dialog).getByRole('button', { name: 'Hinzufügen' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Vorname oder Spitzname angeben.');
    await user.clear(within(dialog).getByLabelText('Nachname'));
    await user.type(within(dialog).getByLabelText('Vorname'), 'anna');
    await user.type(within(dialog).getByLabelText('Nachname'), 'MÜLLER');
    await user.click(within(dialog).getByRole('button', { name: 'Hinzufügen' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('„anna MÜLLER“ gibt es schon.');
    expect(screen.getByRole('heading', { name: '3 Spieler' })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(800); });
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });

  it('closes the create popup with Abbrechen or Escape without saving', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPlayersTab();
    await screen.findByRole('heading', { name: '3 Spieler' });
    await fillCreate(user, 'Lena', 'Graf');
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await fillCreate(user, 'Lena', 'Graf');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(800); });
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });

  it('opens a player lightbox with the names and the statistics over the list, and closes it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPlayersTab();
    await screen.findByRole('heading', { name: '3 Spieler' });
    const form = await openPage(user, 'Ben „Benni“ Weber');
    expect(within(form).getByLabelText('Vorname')).toHaveValue('Ben');
    expect(within(form).getByLabelText('Nachname')).toHaveValue('Weber');
    expect(within(form).getByLabelText('Spitzname')).toHaveValue('Benni');
    expect(screen.getByRole('heading', { name: 'Statistik' })).toBeInTheDocument();
    // Ben is in no gameshow.
    expect(screen.getByText('Noch keine Gameshow mit Ben „Benni“ Weber.')).toBeInTheDocument();
    // The names save as they are typed: there is no save button.
    expect(within(form).queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument();
    // The list stays underneath.
    expect(screen.getByRole('heading', { name: '3 Spieler' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Schließen' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await openPage(user, 'Ben „Benni“ Weber');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the gameshows a player is in, opened from anywhere via openPlayer', async () => {
    renderPlayersTab();
    await screen.findByRole('heading', { name: '3 Spieler' });
    act(() => openPlayer('michi-huber'));
    expect(await screen.findByRole('dialog', { name: 'Michi Huber' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gameshow 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gameshow 2' })).toBeInTheDocument();
  });

  it('says so for an unknown player id', async () => {
    renderPlayersTab();
    await screen.findByRole('heading', { name: '3 Spieler' });
    act(() => openPlayer('ghost'));
    expect(await screen.findByText('Diesen Spieler gibt es nicht (mehr).')).toBeInTheDocument();
  });

  it('edits a player on their page, keeping the id', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPlayersTab();
    await screen.findByRole('heading', { name: '3 Spieler' });
    const form = await openPage(user, 'Michi Huber');
    // Nickname = first name is shown as an empty field.
    expect(within(form).getByLabelText('Spitzname')).toHaveValue('');
    await user.clear(within(form).getByLabelText('Nachname'));
    await user.type(within(form).getByLabelText('Nachname'), 'Hofer');
    // Saved as typed: the heading follows, and the save queue writes it.
    expect(await screen.findByRole('dialog', { name: 'Michi Hofer' })).toBeInTheDocument();
    const saved = await savedConfig();
    expect(saved.players).toContainEqual({ id: 'michi-huber', firstName: 'Michi', lastName: 'Hofer', nickname: 'Michi' });
    // Gameshows reference the id, so they need no change.
    expect(saved.gameshows.gs1!.players).toEqual(['michi-huber', 'anna-mueller']);
  });

  it('an emptied nickname falls back to the first name', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPlayersTab();
    await screen.findByRole('heading', { name: '3 Spieler' });
    const form = await openPage(user, 'Ben „Benni“ Weber');
    await user.clear(within(form).getByLabelText('Spitzname'));
    const saved = await savedConfig();
    expect(saved.players).toContainEqual({ id: 'ben-weber', firstName: 'Ben', lastName: 'Weber', nickname: 'Ben' });
  });

  it('never saves a name onto another player, and saves again once it is fixed', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPlayersTab();
    await screen.findByRole('heading', { name: '3 Spieler' });
    const form = await openPage(user, 'Ben „Benni“ Weber');
    fireEvent.change(within(form).getByLabelText('Vorname'), { target: { value: 'Anna' } });
    fireEvent.change(within(form).getByLabelText('Nachname'), { target: { value: 'Müller' } });
    expect(screen.getByRole('alert')).toHaveTextContent('„Anna Müller“ gibt es schon.');
    // The field keeps what was typed; the registry keeps the last valid name.
    expect(within(form).getByLabelText('Nachname')).toHaveValue('Müller');
    let saved = await savedConfig();
    expect(saved.players).toContainEqual({ id: 'ben-weber', firstName: 'Anna', lastName: 'Weber', nickname: 'Benni' });
    expect(saved.players!.filter(p => p.lastName === 'Müller')).toHaveLength(1);
    // Fixed: the error goes, the name is saved.
    await user.type(within(form).getByLabelText('Nachname'), '-Weber');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    saved = await savedConfig();
    expect(saved.players).toContainEqual({ id: 'ben-weber', firstName: 'Anna', lastName: 'Müller-Weber', nickname: 'Benni' });
  });

  it('keeps what is typed while saving, trailing space included', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPlayersTab();
    await screen.findByRole('heading', { name: '3 Spieler' });
    const form = await openPage(user, 'Anna Müller');
    const first = within(form).getByLabelText('Vorname');
    await user.type(first, ' ');
    // "Anna " is stored as "Anna" — the field must not drop the space mid-word.
    act(() => { vi.advanceTimersByTime(800); });
    expect(first).toHaveValue('Anna ');
    await user.type(first, 'Lena');
    expect(first).toHaveValue('Anna Lena');
    const saved = await savedConfig();
    expect(saved.players).toContainEqual({ id: 'anna-mueller', firstName: 'Anna Lena', lastName: 'Müller', nickname: 'Anna Lena' });
  });

  it('disables a player with the "Aktiv" switch, dims them in the list, and enables them again', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPlayersTab();
    await screen.findByRole('heading', { name: '3 Spieler' });
    await openPage(user, 'Michi Huber');
    const active = screen.getByRole('checkbox', { name: 'Aktiv' });
    expect(active).toBeChecked();
    await user.click(active);
    expect(active).not.toBeChecked();
    expect(screen.getByText(/Deaktiviert: bleibt in seinen Gameshows/)).toBeInTheDocument();
    let saved = await savedConfig();
    expect(saved.players).toContainEqual({ id: 'michi-huber', firstName: 'Michi', lastName: 'Huber', nickname: 'Michi', disabled: true });
    // Still in the gameshows.
    expect(saved.gameshows.gs1!.players).toEqual(['michi-huber', 'anna-mueller']);
    await user.click(active);
    saved = await savedConfig();
    expect(saved.players).toContainEqual({ id: 'michi-huber', firstName: 'Michi', lastName: 'Huber', nickname: 'Michi' });
  });

  it('follows a player added on the show without a reload', async () => {
    renderPlayersTab();
    await screen.findByRole('heading', { name: '3 Spieler' });
    // The show wrote a new player into config.json; the server announces it.
    mockFetchConfig.mockResolvedValue({
      ...sampleConfig,
      players: [...sampleConfig.players!, { id: 'kiki', firstName: '', lastName: '', nickname: 'Kiki' }],
    });
    await act(async () => { __emitChannelForTests('content-changed', { config: true }); });
    expect(await screen.findByRole('heading', { name: '4 Spieler' })).toBeInTheDocument();
  });

  it('shows a change saved in the lightbox in the list at once, and still follows the show afterwards', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPlayersTab();
    await screen.findByRole('heading', { name: '3 Spieler' });
    await openPage(user, 'Michi Huber');
    await user.click(screen.getByRole('checkbox', { name: 'Aktiv' }));
    const saved = await savedConfig();
    const row = () => screen.getByRole('button', { name: 'Michi Huber öffnen' }).closest('li')!;
    await waitFor(() => expect(row()).toHaveClass('is-disabled'));
    expect(within(row()).getByText('Deaktiviert')).toBeInTheDocument();
    // The list took the lightbox's save as its own state: a later change from the
    // show is adopted, not mistaken for a conflict with unsaved edits.
    mockFetchConfig.mockResolvedValue({
      ...saved,
      players: [...saved.players!, { id: 'kiki', firstName: '', lastName: '', nickname: 'Kiki' }],
    });
    await act(async () => { __emitChannelForTests('content-changed', { config: true }); });
    expect(await screen.findByRole('heading', { name: '4 Spieler' })).toBeInTheDocument();
    expect(row()).toHaveClass('is-disabled');
  });

  it('dims a disabled player in the list and marks them "Deaktiviert"', async () => {
    mockFetchConfig.mockResolvedValue({
      ...sampleConfig,
      players: sampleConfig.players!.map(p => (p.id === 'ben-weber' ? { ...p, disabled: true } : p)),
    });
    renderPlayersTab();
    await screen.findByRole('heading', { name: '3 Spieler' });
    const row = screen.getByRole('button', { name: 'Ben „Benni“ Weber öffnen' }).closest('li')!;
    expect(row).toHaveClass('is-disabled');
    expect(within(row).getByText('Deaktiviert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anna Müller öffnen' }).closest('li')).not.toHaveClass('is-disabled');
  });

  it('lists a player added during the show by nickname, marked "Name fehlt"', async () => {
    mockFetchConfig.mockResolvedValue({
      ...sampleConfig,
      players: [...sampleConfig.players!, { id: 'kiki', firstName: '', lastName: '', nickname: 'Kiki' }],
    });
    renderPlayersTab();
    await screen.findByRole('heading', { name: '4 Spieler' });
    expect(listedNames()).toEqual(['Anna Müller', 'Ben „Benni“ Weber', 'KikiName fehlt', 'Michi Huber']);
  });

  it('deletes a player from the lightbox and closes it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPlayersTab();
    await screen.findByRole('heading', { name: '3 Spieler' });
    await openPage(user, 'Anna Müller');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Löschen' }));
    // Escape belongs to the confirmation: the lightbox stays.
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Anna Müller' })).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Löschen' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const saved = await savedConfig();
    expect(saved.players!.map(p => p.id)).toEqual(['michi-huber', 'ben-weber']);
  });

  it('deletes a used player after confirming and removes them from every gameshow', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPlayersTab();
    await screen.findByRole('heading', { name: '3 Spieler' });
    await user.click(screen.getByRole('button', { name: 'Michi Huber löschen' }));
    expect(screen.getByText(/In 2 Gameshows eingetragen \(Gameshow 1, Gameshow 2\)/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    expect(await screen.findByRole('heading', { name: '2 Spieler' })).toBeInTheDocument();
    const saved = await savedConfig();
    expect(saved.players!.map(p => p.id)).toEqual(['anna-mueller', 'ben-weber']);
    expect(saved.gameshows.gs1!.players).toEqual(['anna-mueller']);
    expect(saved.gameshows.gs2!.players).toEqual([]);
  });

  it('keeps the player when the delete is cancelled', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPlayersTab();
    await screen.findByRole('heading', { name: '3 Spieler' });
    await user.click(screen.getByRole('button', { name: 'Ben „Benni“ Weber löschen' }));
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.getByRole('heading', { name: '3 Spieler' })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(800); });
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });

  it('shows "Noch keine Spieler." for an empty registry', async () => {
    mockFetchConfig.mockResolvedValue({ ...sampleConfig, players: undefined });
    renderPlayersTab();
    expect(await screen.findByText('Noch keine Spieler.')).toBeInTheDocument();
  });
});
