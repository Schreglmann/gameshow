import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { ThemeProvider } from '@/context/ThemeContext';
import GamemasterScreen from '@/components/screens/GamemasterScreen';
import {
  sendWs,
  __emitChannelForTests,
  __emitOpenForTests,
  __clearWsCacheForTests,
} from '@/services/useBackendSocket';

vi.mock('@/hooks/useGamemasterSync', () => ({
  useGamemasterAnswer: () => null,
  useGamemasterControls: () => null,
  useSendGamemasterCommand: () => vi.fn(),
}));

vi.mock('@/services/useBackendSocket', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/useBackendSocket')>();
  return { ...actual, sendWs: vi.fn(() => true) };
});

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
    enabledJokers: [],
  }),
  fetchRunOfShow: vi.fn().mockResolvedValue({ games: [] }),
  fetchTheme: vi.fn().mockResolvedValue({ frontend: 'galaxia', admin: 'galaxia' }),
  saveTheme: vi.fn().mockResolvedValue(undefined),
}));

const sendWsMock = vi.mocked(sendWs);

function renderScreen() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <GameProvider>
          <GamemasterScreen />
        </GameProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

function controlsSends() {
  return sendWsMock.mock.calls.filter(([channel]) => channel === 'show-controls-hidden');
}

describe('GamemasterScreen — "Show-Buttons ausblenden" toggle', () => {
  beforeEach(() => {
    localStorage.clear();
    __clearWsCacheForTests();
    sendWsMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is off by default', () => {
    renderScreen();
    const toggle = screen.getByRole('button', { name: 'Show-Buttons ausblenden' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.className).not.toContain('gm-show-controls-toggle--active');
  });

  it('sends the new value on the show-controls-hidden channel when clicked', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Show-Buttons ausblenden' }));
    expect(controlsSends()).toEqual([['show-controls-hidden', { hidden: true }]]);

    const toggle = screen.getByRole('button', { name: 'Show-Buttons einblenden' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.className).toContain('gm-show-controls-toggle--active');

    fireEvent.click(toggle);
    expect(controlsSends().at(-1)).toEqual(['show-controls-hidden', { hidden: false }]);
  });

  it('follows the cached channel value', () => {
    renderScreen();
    act(() => { __emitChannelForTests('show-controls-hidden', { hidden: true }); });
    expect(screen.getByRole('button', { name: 'Show-Buttons einblenden' })).toBeInTheDocument();
    act(() => { __emitChannelForTests('show-controls-hidden', { hidden: false }); });
    expect(screen.getByRole('button', { name: 'Show-Buttons ausblenden' })).toBeInTheDocument();
  });

  it('re-sends its value after a reconnect when the server brought none (server restart)', () => {
    vi.useFakeTimers();
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Show-Buttons ausblenden' }));
    sendWsMock.mockClear();

    act(() => { __emitOpenForTests(); });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(controlsSends()).toEqual([['show-controls-hidden', { hidden: true }]]);
  });

  it('does not re-send after a reconnect when the server sent a value (another GM may have changed it)', () => {
    vi.useFakeTimers();
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Show-Buttons ausblenden' }));
    sendWsMock.mockClear();

    act(() => { __emitOpenForTests(); });
    act(() => { __emitChannelForTests('show-controls-hidden', { hidden: false }); });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(controlsSends()).toEqual([]);
    expect(screen.getByRole('button', { name: 'Show-Buttons ausblenden' })).toBeInTheDocument();
  });

  it('sends nothing after a reconnect while it knows no value', () => {
    vi.useFakeTimers();
    renderScreen();
    act(() => { __emitOpenForTests(); });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(controlsSends()).toEqual([]);
  });
});
