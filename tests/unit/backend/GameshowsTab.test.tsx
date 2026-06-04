import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@/context/ThemeContext';
import GameshowsTab from '@/components/backend/GameshowsTab';
import type { AppConfig } from '@/types/config';

function renderGameshowsTab() {
  return render(<MemoryRouter><ThemeProvider><GameshowsTab /></ThemeProvider></MemoryRouter>);
}

const mockFetchConfig = vi.fn();
const mockSaveConfig = vi.fn();
const mockFetchGames = vi.fn();

vi.mock('@/services/backendApi', () => ({
  fetchConfig: (...args: unknown[]) => mockFetchConfig(...args),
  saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
  fetchGames: (...args: unknown[]) => mockFetchGames(...args),
}));

const sampleConfig: AppConfig = {
  pointSystemEnabled: true,
  teamRandomizationEnabled: true,
  globalRules: [],
  activeGameshow: 'gs1',
  gameshows: {
    gs1: { name: 'Gameshow 1', gameOrder: ['quiz-1/v1'] },
    gs2: { name: 'Gameshow 2', gameOrder: [] },
  },
};

/** Returns the `.backend-card` element that wraps the gameshow whose name text is `name`. */
function cardFor(name: string): HTMLElement {
  const nameEl = screen.getByText(name);
  const card = nameEl.closest('.backend-card');
  if (!card) throw new Error(`No card found for "${name}"`);
  return card as HTMLElement;
}

describe('GameshowsTab', () => {
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

  it('shows loading state initially', () => {
    mockFetchConfig.mockReturnValue(new Promise(() => {}));
    renderGameshowsTab();
    expect(screen.getByText('Lade Gameshows...')).toBeInTheDocument();
  });

  it('renders the Gameshows title after loading', async () => {
    renderGameshowsTab();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Gameshows' })).toBeInTheDocument();
    });
  });

  it('renders all gameshows', async () => {
    renderGameshowsTab();
    await waitFor(() => {
      expect(screen.getByText('Gameshow 1')).toBeInTheDocument();
      expect(screen.getByText('Gameshow 2')).toBeInTheDocument();
    });
  });

  it('renders "+ Neue Gameshow" button', async () => {
    renderGameshowsTab();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ Neue Gameshow' })).toBeInTheDocument();
    });
  });

  it('shows the active badge on the active gameshow and "Als aktiv setzen" on the other', async () => {
    renderGameshowsTab();
    await waitFor(() => {
      expect(screen.getByText('✓ Aktiv')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Als aktiv setzen' })).toBeInTheDocument();
  });

  it('sets a different gameshow as active and autosaves', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderGameshowsTab();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Als aktiv setzen' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Als aktiv setzen' }));
    await waitFor(() => {
      expect(screen.getAllByText('✓ Aktiv')).toHaveLength(1);
    });
    act(() => { vi.advanceTimersByTime(800); });
    await waitFor(() => {
      expect(mockSaveConfig).toHaveBeenCalledWith(
        expect.objectContaining({ activeGameshow: 'gs2' })
      );
    });
  });

  it('deletes a gameshow on confirmed delete', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderGameshowsTab();
    await waitFor(() => {
      expect(screen.getAllByTitle('Gameshow löschen')).toHaveLength(2);
    });
    await user.click(screen.getAllByTitle('Gameshow löschen')[1]);
    await waitFor(() => {
      expect(screen.queryByText('Gameshow 2')).not.toBeInTheDocument();
    });
  });

  it('renames a gameshow inline: click name → edit → blur commits a new id + name', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderGameshowsTab();
    await waitFor(() => {
      expect(screen.getByText('Gameshow 1')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Gameshow 1'));
    const input = screen.getByDisplayValue('Gameshow 1');
    await user.clear(input);
    await user.type(input, 'Renamed Show');
    await user.tab(); // blur commits
    act(() => { vi.advanceTimersByTime(800); });
    await waitFor(() => {
      expect(mockSaveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          gameshows: expect.objectContaining({
            'renamed-show': expect.objectContaining({ name: 'Renamed Show' }),
          }),
        })
      );
    });
    // The renamed gameshow keeps its position — it must NOT jump to the end.
    const saved = mockSaveConfig.mock.calls.at(-1)![0] as typeof sampleConfig;
    expect(Object.keys(saved.gameshows)).toEqual(['renamed-show', 'gs2']);
  });

  // ── Collapse / expand behavior — see specs/admin-gameshows-tab.md ──

  it('expands only the active gameshow on load', async () => {
    renderGameshowsTab();
    await waitFor(() => {
      expect(screen.getByText('Gameshow 1')).toBeInTheDocument();
    });
    // gs1 is active → expanded; gs2 → collapsed.
    expect(within(cardFor('Gameshow 1')).getByRole('button', { name: 'Gameshow einklappen' })).toBeInTheDocument();
    expect(within(cardFor('Gameshow 2')).getByRole('button', { name: 'Gameshow ausklappen' })).toBeInTheDocument();
    // Exactly one card is expanded.
    expect(screen.getAllByRole('button', { name: 'Gameshow einklappen' })).toHaveLength(1);
  });

  it('does NOT expand a gameshow when it is activated, and keeps the previously-open one open', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderGameshowsTab();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Als aktiv setzen' })).toBeInTheDocument();
    });
    // Activate gs2 (currently collapsed).
    await user.click(screen.getByRole('button', { name: 'Als aktiv setzen' }));
    await waitFor(() => {
      expect(screen.getAllByText('✓ Aktiv')).toHaveLength(1);
    });
    // gs2 is now active but must stay collapsed; gs1 stays expanded.
    expect(within(cardFor('Gameshow 2')).getByRole('button', { name: 'Gameshow ausklappen' })).toBeInTheDocument();
    expect(within(cardFor('Gameshow 1')).getByRole('button', { name: 'Gameshow einklappen' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Gameshow einklappen' })).toHaveLength(1);
  });

  it('opens a newly created gameshow expanded', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderGameshowsTab();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ Neue Gameshow' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: '+ Neue Gameshow' }));
    await waitFor(() => {
      expect(screen.getByText('Neue Gameshow')).toBeInTheDocument();
    });
    expect(within(cardFor('Neue Gameshow')).getByRole('button', { name: 'Gameshow einklappen' })).toBeInTheDocument();
  });
});
