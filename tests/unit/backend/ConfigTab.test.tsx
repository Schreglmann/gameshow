import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@/context/ThemeContext';
import ConfigTab from '@/components/backend/ConfigTab';
import type { AppConfig } from '@/types/config';

function renderConfigTab() {
  return render(<MemoryRouter><ThemeProvider><ConfigTab /></ThemeProvider></MemoryRouter>);
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

  it('renders "Gameshows" section title', async () => {
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByText('Gameshows')).toBeInTheDocument();
    });
  });

  it('renders all gameshows', async () => {
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByDisplayValue('Gameshow 1')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Gameshow 2')).toBeInTheDocument();
    });
  });

  it('renders "+ Neue Gameshow" button', async () => {
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ Neue Gameshow' })).toBeInTheDocument();
    });
  });

  it('adds new gameshow when button is clicked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ Neue Gameshow' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: '+ Neue Gameshow' }));
    await waitFor(() => {
      expect(screen.getByDisplayValue('Neue Gameshow')).toBeInTheDocument();
    });
  });

  it('deletes gameshow on confirmed delete', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getAllByTitle('Gameshow löschen')).toHaveLength(2);
    });
    await user.click(screen.getAllByTitle('Gameshow löschen')[1]);
    await waitFor(() => {
      expect(screen.queryByDisplayValue('Gameshow 2')).not.toBeInTheDocument();
    });
  });

  it('does NOT delete gameshow when confirm is cancelled', async () => {
    window.confirm = vi.fn(() => false);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getAllByTitle('Gameshow löschen')).toHaveLength(2);
    });
    await user.click(screen.getAllByTitle('Gameshow löschen')[0]);
    expect(screen.getByDisplayValue('Gameshow 1')).toBeInTheDocument();
    window.confirm = () => true;
  });

  it('requires confirm before deleting gameshow', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getAllByTitle('Gameshow löschen')).toHaveLength(2);
    });
    await user.click(screen.getAllByTitle('Gameshow löschen')[0]);
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('wirklich löschen'));
    confirmSpy.mockRestore();
  });

  it('auto-saves config after 800ms debounce when checkbox changes', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getAllByRole('checkbox')).toHaveLength(2);
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
      expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    });

    await user.click(screen.getAllByRole('checkbox')[0]);
    act(() => { vi.advanceTimersByTime(400); });
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });

  it('shows success toast after saving', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    });

    await user.click(screen.getAllByRole('checkbox')[0]);
    act(() => { vi.advanceTimersByTime(800); });

    await waitFor(() => {
      expect(screen.getByText(/Config gespeichert/)).toBeInTheDocument();
    });
  });

  it('shows error toast when save fails', async () => {
    mockSaveConfig.mockRejectedValueOnce(new Error('Save error'));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    });

    await user.click(screen.getAllByRole('checkbox')[0]);
    act(() => { vi.advanceTimersByTime(800); });

    await waitFor(() => {
      expect(screen.getByText(/Save error/)).toBeInTheDocument();
    });
  });

  it('shows active badge on the active gameshow', async () => {
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByText('✓ Aktiv')).toBeInTheDocument();
    });
  });

  it('shows "Als aktiv setzen" for non-active gameshows', async () => {
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Als aktiv setzen' })).toBeInTheDocument();
    });
  });

  it('sets a different gameshow as active when "Als aktiv setzen" is clicked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderConfigTab();
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

  it('updates gameshow name when name input changes', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderConfigTab();
    await waitFor(() => {
      expect(screen.getByDisplayValue('Gameshow 1')).toBeInTheDocument();
    });
    const nameInput = screen.getByDisplayValue('Gameshow 1');
    await user.clear(nameInput);
    await user.type(nameInput, 'My Show');
    expect(screen.getByDisplayValue('My Show')).toBeInTheDocument();
  });
});
