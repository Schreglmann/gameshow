import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider, THEMES, ADMIN_THEMES } from '@/context/ThemeContext';
import ConfigTab from '@/components/backend/ConfigTab';
import { GENERIC_JOKER_RULES } from '@/data/jokers';
import { POINT_MODE_RULE_DEFAULTS } from '@/utils/pointMode';
import type { AppConfig } from '@/types/config';
import { getStatus } from '@/services/saveQueue';

function renderConfigTab() {
  return render(<MemoryRouter><ThemeProvider><ConfigTab /></ThemeProvider></MemoryRouter>);
}

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
  globalRules: ['Rule 1', 'Rule 2'],
  activeGameshow: 'gs1',
  gameshows: {
    gs1: { name: 'Gameshow 1', gameOrder: ['quiz-1/v1'] },
    gs2: { name: 'Gameshow 2', gameOrder: [] },
  },
};

describe('ConfigTab', () => {
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
    renderConfigTab();
    expect(screen.getByText('Lade Config...')).toBeInTheDocument();
  });

  it('shows error state when config cannot be loaded (null config)', async () => {
    mockFetchConfig.mockRejectedValue(new Error('Network error'));
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByText(/Config konnte nicht geladen werden/)).toBeInTheDocument();
    });
  });

  it('renders Konfiguration title after loading', async () => {
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByText('Konfiguration')).toBeInTheDocument();
    });
  });

  it('renders "Globale Einstellungen" card', async () => {
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByText('Globale Einstellungen')).toBeInTheDocument();
    });
  });

  it('renders "Punktesystem aktiviert" checkbox', async () => {
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByText('Punktesystem aktiviert')).toBeInTheDocument();
    });
  });

  it('renders "Team-Randomisierung aktiviert" checkbox', async () => {
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByText('Team-Randomisierung aktiviert')).toBeInTheDocument();
    });
  });

  it('pointSystemEnabled checkbox reflects config value', async () => {
    renderConfigTab();
    await waitFor(() => {
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes[0]).toBeChecked();
    });
  });

  it('teamRandomizationEnabled checkbox reflects config value', async () => {
    renderConfigTab();
    await waitFor(() => {
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes[1]).toBeChecked();
    });
  });

  it('renders "Globale Regeln" card', async () => {
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByText('Globale Regeln')).toBeInTheDocument();
    });
  });

  it('shows existing global rules', async () => {
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByDisplayValue('Rule 1')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Rule 2')).toBeInTheDocument();
    });
  });

  it('renders "Punkte-Regel-Texte" card', async () => {
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByText('Punkte-Regel-Texte')).toBeInTheDocument();
    });
  });

  it('prefills every point-mode field with its built-in default when config has none', async () => {
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByDisplayValue(POINT_MODE_RULE_DEFAULTS.positional)).toBeInTheDocument();
      expect(screen.getByDisplayValue(POINT_MODE_RULE_DEFAULTS.flat)).toBeInTheDocument();
      expect(screen.getByDisplayValue(POINT_MODE_RULE_DEFAULTS['per-correct-answer'])).toBeInTheDocument();
    });
  });

  it('shows an existing pointModeRules override from config', async () => {
    mockFetchConfig.mockResolvedValue({ ...sampleConfig, pointModeRules: { flat: 'Eigener Punkte-Text' } });
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByDisplayValue('Eigener Punkte-Text')).toBeInTheDocument();
    });
  });

  it('editing a Punkte-Regel-Text autosaves config.pointModeRules', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByDisplayValue(POINT_MODE_RULE_DEFAULTS.flat)).toBeInTheDocument();
    });

    const input = screen.getByDisplayValue(POINT_MODE_RULE_DEFAULTS.flat);
    await user.clear(input);
    await user.type(input, 'Geänderter Punkte-Text');
    act(() => { vi.advanceTimersByTime(800); });

    await waitFor(() => {
      expect(mockSaveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          pointModeRules: expect.objectContaining({ flat: 'Geänderter Punkte-Text' }),
        })
      );
    });
  });

  // Global show title — see specs/show-title.md.
  it('renders the show-title field with the default as placeholder', async () => {
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByLabelText('Titel der Show')).toHaveAttribute('placeholder', 'Game Show');
    });
    expect(screen.getByLabelText('Titel der Show')).toHaveValue('');
  });

  it('shows the configured show title', async () => {
    mockFetchConfig.mockResolvedValue({ ...sampleConfig, showTitle: 'Sommerfest Quiz' });
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByLabelText('Titel der Show')).toHaveValue('Sommerfest Quiz');
    });
  });

  it('editing the show title autosaves config.showTitle', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByLabelText('Titel der Show')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Titel der Show'), 'Sommerfest');
    act(() => { vi.advanceTimersByTime(800); });

    await waitFor(() => {
      expect(mockSaveConfig).toHaveBeenCalledWith(
        expect.objectContaining({ showTitle: 'Sommerfest' })
      );
    });
  });

  it('renders "Joker-Regeln" card', async () => {
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByText('Joker-Regeln')).toBeInTheDocument();
    });
  });

  it('prefills Joker-Regeln with the built-in default when config has none', async () => {
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByDisplayValue(GENERIC_JOKER_RULES[0])).toBeInTheDocument();
    });
  });

  it('shows existing jokerRules from config', async () => {
    mockFetchConfig.mockResolvedValue({ ...sampleConfig, jokerRules: ['Eigene Joker-Regel'] });
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByDisplayValue('Eigene Joker-Regel')).toBeInTheDocument();
    });
  });

  it('editing a Joker-Regel autosaves config.jokerRules', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByDisplayValue(GENERIC_JOKER_RULES[0])).toBeInTheDocument();
    });

    const input = screen.getByDisplayValue(GENERIC_JOKER_RULES[0]);
    await user.clear(input);
    await user.type(input, 'Geänderte Joker-Regel');
    act(() => { vi.advanceTimersByTime(800); });

    await waitFor(() => {
      expect(mockSaveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          jokerRules: expect.arrayContaining(['Geänderte Joker-Regel']),
        })
      );
    });
  });

  it('does NOT render the Gameshows section (moved to its own tab)', async () => {
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByText('Konfiguration')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: '+ Neue Gameshow' })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Gameshow 1')).not.toBeInTheDocument();
  });

  it('auto-saves config after 800ms debounce when checkbox changes', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByText('Punktesystem aktiviert')).toBeInTheDocument();
    });

    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]); // toggle pointSystemEnabled

    act(() => { vi.advanceTimersByTime(800); });

    await waitFor(() => {
      expect(mockSaveConfig).toHaveBeenCalledWith(
        expect.objectContaining({ pointSystemEnabled: false })
      );
    });
  });

  it('does NOT save before 800ms debounce', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByText('Punktesystem aktiviert')).toBeInTheDocument();
    });

    await user.click(screen.getAllByRole('checkbox')[0]);
    act(() => { vi.advanceTimersByTime(400); });
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });

  // The "Gespeichert" toast is owned by the shell's SaveStatusIndicator, not by this pane —
  // it has to survive the pane unmounting. Here we only assert the write itself; the toast is
  // covered in SaveStatusIndicator.test.tsx. See specs/admin-save-queue.md.
  it('reaches idle once the debounced save lands', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByText('Punktesystem aktiviert')).toBeInTheDocument();
    });

    await user.click(screen.getAllByRole('checkbox')[0]);
    act(() => { vi.advanceTimersByTime(800); });

    await waitFor(() => expect(mockSaveConfig).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getStatus().state).toBe('idle'));
    expect(screen.queryByText(/gespeichert/i)).not.toBeInTheDocument();
  });

  // A failed save is no longer reported by a toast in this pane — the pane can be gone
  // before the failure is known. The queue keeps the payload and retries it, and the
  // admin shell's save-status pill reports the failure. See specs/admin-save-queue.md.
  it('keeps retrying a failed save instead of dropping it', async () => {
    mockSaveConfig.mockRejectedValueOnce(new Error('Save error'));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByText('Punktesystem aktiviert')).toBeInTheDocument();
    });

    await user.click(screen.getAllByRole('checkbox')[0]);
    act(() => { vi.advanceTimersByTime(800); });
    await waitFor(() => expect(mockSaveConfig).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getStatus().state).toBe('retrying'));

    // First backoff step: 1s.
    await act(async () => { vi.advanceTimersByTime(1000); });
    await waitFor(() => expect(mockSaveConfig).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getStatus().state).toBe('idle'));
  });

  it('Gameshow theme selector renders all 13 themes', async () => {
    const { container } = renderConfigTab();
    await waitFor(() => {
      expect(screen.getByText('Themes')).toBeInTheDocument();
    });
    const selectors = container.querySelectorAll('.theme-selector');
    expect(selectors).toHaveLength(2);
    // First selector = Gameshow (frontend) → every theme available.
    expect(selectors[0].querySelectorAll('.theme-option')).toHaveLength(THEMES.length);
    expect(THEMES.length).toBe(13);
  });

  it('Admin theme selector renders only the curated admin subset', async () => {
    const { container } = renderConfigTab();
    await waitFor(() => {
      expect(screen.getByText('Themes')).toBeInTheDocument();
    });
    // Second selector = Admin → restricted subset only.
    const adminSelector = container.querySelectorAll('.theme-selector')[1];
    expect(adminSelector.querySelectorAll('.theme-option')).toHaveLength(ADMIN_THEMES.length);
    expect(ADMIN_THEMES.length).toBe(5);
    const adminText = adminSelector.textContent ?? '';
    expect(adminText).toContain('Atlas');
    expect(adminText).toContain('Atlas Light');
    expect(adminText).toContain('Galaxia');
    expect(adminText).toContain('Tiefsee');
    expect(adminText).toContain('Enterprise');
    for (const removed of ['Harry Potter', 'D&D', 'Retro', 'Minecraft', 'Classical Music', 'Modern Music', 'Filme', 'Pub Quiz']) {
      expect(adminText).not.toContain(removed);
    }
  });
});

describe('ADMIN_THEMES', () => {
  it('contains exactly atlas, atlas-light, galaxia, deepsea, enterprise (in THEMES order)', () => {
    expect(ADMIN_THEMES.map(t => t.id)).toEqual(['atlas', 'atlas-light', 'galaxia', 'deepsea', 'enterprise']);
  });
});
