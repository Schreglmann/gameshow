import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { GameProvider, useGameContext } from '@/context/GameContext';
import { __emitChannelForTests, __clearWsCacheForTests } from '@/services/useBackendSocket';
import { fetchSettings } from '@/services/api';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn(),
}));

const mockedFetchSettings = vi.mocked(fetchSettings);

function TestConsumer() {
  const { state } = useGameContext();
  return (
    <div>
      <div data-testid="point-system">{String(state.settings.pointSystemEnabled)}</div>
      <div data-testid="rules">{JSON.stringify(state.settings.globalRules)}</div>
      <div data-testid="settings-loaded">{String(state.settingsLoaded)}</div>
    </div>
  );
}

describe('GameContext — live config reload', () => {
  beforeEach(() => {
    localStorage.clear();
    __clearWsCacheForTests();
    mockedFetchSettings.mockReset();
  });

  it('re-fetches settings when content-changed { config } arrives and applies the new values', async () => {
    mockedFetchSettings.mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      globalRules: ['alt'],
      enabledJokers: [],
    });
    render(<GameProvider><TestConsumer /></GameProvider>);
    await vi.waitFor(() => expect(screen.getByTestId('settings-loaded').textContent).toBe('true'));
    expect(mockedFetchSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('point-system').textContent).toBe('true');

    // Server now reports a changed config (point system off, rules edited).
    mockedFetchSettings.mockResolvedValue({
      pointSystemEnabled: false,
      teamRandomizationEnabled: true,
      globalRules: ['neu'],
      enabledJokers: [],
    });
    await act(async () => {
      __emitChannelForTests('content-changed', { config: true });
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId('point-system').textContent).toBe('false');
    });
    expect(mockedFetchSettings).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('rules').textContent).toBe(JSON.stringify(['neu']));
  });

  it('does not re-fetch settings for a content-changed without the config flag', async () => {
    mockedFetchSettings.mockResolvedValue({
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      globalRules: [],
      enabledJokers: [],
    });
    render(<GameProvider><TestConsumer /></GameProvider>);
    await vi.waitFor(() => expect(screen.getByTestId('settings-loaded').textContent).toBe('true'));
    expect(mockedFetchSettings).toHaveBeenCalledTimes(1);

    await act(async () => {
      __emitChannelForTests('content-changed', { theme: true, games: true });
    });

    expect(mockedFetchSettings).toHaveBeenCalledTimes(1);
  });
});
