import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@/context/ThemeContext';
import ConfigTab from '@/components/backend/ConfigTab';
import GameshowsTab from '@/components/backend/GameshowsTab';
import { __emitChannelForTests, __clearWsCacheForTests } from '@/services/useBackendSocket';
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

const baseConfig: AppConfig = {
  pointSystemEnabled: true,
  teamRandomizationEnabled: true,
  globalRules: ['Rule 1'],
  activeGameshow: 'gs1',
  gameshows: {
    gs1: { name: 'Gameshow 1', gameOrder: [] },
    gs2: { name: 'Gameshow 2', gameOrder: [] },
  },
};

const clone = (): AppConfig => JSON.parse(JSON.stringify(baseConfig)) as AppConfig;

const renderConfigTab = () =>
  render(<MemoryRouter><ThemeProvider><ConfigTab /></ThemeProvider></MemoryRouter>);

const renderGameshowsTab = () =>
  render(<MemoryRouter><ThemeProvider><GameshowsTab /></ThemeProvider></MemoryRouter>);

/**
 * The reported bug and its neighbours — see specs/admin-save-queue.md.
 * Admin panes are conditionally rendered, so switching tabs unmounts them.
 */
describe('useEditableConfig — saves that outlive the pane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockFetchConfig.mockResolvedValue(clone());
    mockSaveConfig.mockResolvedValue(undefined);
    mockFetchGames.mockResolvedValue([]);
    __clearWsCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('still saves a setting toggled immediately before the pane unmounts', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = renderConfigTab();
    await waitFor(() => expect(screen.getByText('Punktesystem aktiviert')).toBeInTheDocument());

    await user.click(screen.getAllByRole('checkbox')[0]);
    // Navigate away well inside the 800 ms debounce window — this used to cancel the PUT.
    unmount();
    expect(mockSaveConfig).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(800); });

    await waitFor(() => expect(mockSaveConfig).toHaveBeenCalledTimes(1));
    expect(mockSaveConfig.mock.calls[0][0]).toMatchObject({ pointSystemEnabled: false });
  });

  it('hands the queued edit to the pane that replaces it, even when disk is still stale', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    // The save never lands, so disk stays at the pre-edit version for the whole test.
    mockSaveConfig.mockImplementation(() => new Promise(() => {}));

    const { unmount } = renderConfigTab();
    await waitFor(() => expect(screen.getByText('Punktesystem aktiviert')).toBeInTheDocument());
    await user.click(screen.getAllByRole('checkbox')[0]);
    unmount();
    await act(async () => { vi.advanceTimersByTime(800); });
    await waitFor(() => expect(mockSaveConfig).toHaveBeenCalledTimes(1));

    // The Gameshows pane mounts and its GET returns the stale on-disk config.
    mockFetchConfig.mockResolvedValue(clone());
    renderGameshowsTab();
    await waitFor(() => expect(screen.getByText('Gameshow 1')).toBeInTheDocument());

    // It must have started from the queued payload, not from that stale read: renaming a
    // gameshow now has to write BOTH changes.
    const user2 = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user2.click(screen.getByText('Gameshow 2'));
    await act(async () => { vi.advanceTimersByTime(1000); });

    const written = mockSaveConfig.mock.calls.at(-1)?.[0] as AppConfig;
    expect(written.pointSystemEnabled).toBe(false);   // the Config pane's edit survived
  });

  it('raises no conflict banner for a save that landed after its pane unmounted', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = renderConfigTab();
    await waitFor(() => expect(screen.getByText('Punktesystem aktiviert')).toBeInTheDocument());
    await user.click(screen.getAllByRole('checkbox')[0]);
    unmount();
    await act(async () => { vi.advanceTimersByTime(800); });
    await waitFor(() => expect(mockSaveConfig).toHaveBeenCalledTimes(1));

    // Disk now carries our write; the watcher broadcasts it back at the pane that replaced us.
    const saved = mockSaveConfig.mock.calls[0][0] as AppConfig;
    mockFetchConfig.mockResolvedValue(JSON.parse(JSON.stringify(saved)) as AppConfig);
    renderConfigTab();
    await waitFor(() => expect(screen.getByText('Punktesystem aktiviert')).toBeInTheDocument());

    await act(async () => { __emitChannelForTests('content-changed', { config: true }); });
    await act(async () => { vi.advanceTimersByTime(100); });

    expect(screen.queryByText(/in einem anderen Tab geändert/i)).not.toBeInTheDocument();
    // And it must not have bounced our own write straight back to the server.
    expect(mockSaveConfig).toHaveBeenCalledTimes(1);
  });
});
