import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@/context/ThemeContext';
import ConfigTab from '@/components/backend/ConfigTab';
import type { AppConfig } from '@/types/config';
import { __emitChannelForTests, __clearWsCacheForTests } from '@/services/useBackendSocket';

const mockFetchConfig = vi.fn();
const mockSaveConfig = vi.fn();
const mockFetchGames = vi.fn();

vi.mock('@/services/backendApi', () => ({
  fetchConfig: (...args: unknown[]) => mockFetchConfig(...args),
  saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
  fetchGames: (...args: unknown[]) => mockFetchGames(...args),
}));

function renderConfigTab() {
  return render(<MemoryRouter><ThemeProvider><ConfigTab /></ThemeProvider></MemoryRouter>);
}

const sampleConfig: AppConfig = {
  pointSystemEnabled: true,
  teamRandomizationEnabled: true,
  globalRules: ['Rule 1'],
  activeGameshow: 'gs1',
  gameshows: {
    gs1: { name: 'Gameshow 1', gameOrder: ['quiz-1/v1'] },
    gs2: { name: 'Gameshow 2', gameOrder: [] },
  },
};

const BANNER_RE = /in einem anderen Tab geändert/i;

describe('ConfigTab — cross-tab live sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockFetchConfig.mockResolvedValue(sampleConfig);
    mockSaveConfig.mockResolvedValue(undefined);
    mockFetchGames.mockResolvedValue([]);
    __clearWsCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adopts a remote config change in place when there are no unsaved edits', async () => {
    renderConfigTab();
    await waitFor(() => expect(screen.getByDisplayValue('Rule 1')).toBeInTheDocument());

    mockFetchConfig.mockResolvedValue({ ...sampleConfig, globalRules: ['Rule 1 Remote'] });
    await act(async () => {
      __emitChannelForTests('content-changed', { config: true });
    });

    await waitFor(() => expect(screen.getByDisplayValue('Rule 1 Remote')).toBeInTheDocument());
    expect(screen.queryByText(BANNER_RE)).not.toBeInTheDocument();
  });

  it('does NOT re-save after adopting a remote config (no ping-pong)', async () => {
    renderConfigTab();
    await waitFor(() => expect(screen.getByDisplayValue('Rule 1')).toBeInTheDocument());

    mockFetchConfig.mockResolvedValue({ ...sampleConfig, globalRules: ['Remote Rule'] });
    await act(async () => {
      __emitChannelForTests('content-changed', { config: true });
    });
    await waitFor(() => expect(screen.getByDisplayValue('Remote Rule')).toBeInTheDocument());

    act(() => { vi.advanceTimersByTime(1000); });
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });

  it('shows a conflict banner (and keeps local edits) when a remote change arrives with unsaved edits', async () => {
    mockSaveConfig.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderConfigTab();
    await waitFor(() => expect(screen.getByText('Punktesystem aktiviert')).toBeInTheDocument());

    // Local unsaved edit: toggle the point-system checkbox (true → false).
    await user.click(screen.getAllByRole('checkbox')[0]);
    expect(screen.getAllByRole('checkbox')[0]).not.toBeChecked();

    // Remote change still reports pointSystemEnabled: true.
    mockFetchConfig.mockResolvedValue({ ...sampleConfig, globalRules: ['Remote Rule'] });
    await act(async () => {
      __emitChannelForTests('content-changed', { config: true });
    });

    await waitFor(() => expect(screen.getByText(BANNER_RE)).toBeInTheDocument());
    // Local edit preserved — not overwritten by the remote (still unchecked).
    expect(screen.getAllByRole('checkbox')[0]).not.toBeChecked();
  });

  it('ignores a content-changed without the config flag', async () => {
    renderConfigTab();
    await waitFor(() => expect(screen.getByDisplayValue('Rule 1')).toBeInTheDocument());
    mockFetchConfig.mockClear();

    await act(async () => {
      __emitChannelForTests('content-changed', { games: true, theme: true });
    });
    expect(mockFetchConfig).not.toHaveBeenCalled();
  });
});
