import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ThemeProvider, useTheme } from '@/context/ThemeContext';
import { __emitChannelForTests, __clearWsCacheForTests } from '@/services/useBackendSocket';
import { fetchTheme } from '@/services/api';

vi.mock('@/services/api', () => ({
  fetchTheme: vi.fn(),
  saveTheme: vi.fn().mockResolvedValue({ frontend: 'galaxia', admin: 'galaxia' }),
}));

const mockedFetchTheme = vi.mocked(fetchTheme);

function TestConsumer() {
  const { activeTheme } = useTheme();
  return <div data-testid="active-theme">{activeTheme}</div>;
}

describe('ThemeContext — live theme reload', () => {
  beforeEach(() => {
    localStorage.clear();
    __clearWsCacheForTests();
    document.documentElement.className = '';
    mockedFetchTheme.mockReset();
  });

  it('re-fetches and applies the theme with a transition when content-changed { theme } arrives', async () => {
    mockedFetchTheme.mockResolvedValue({ frontend: 'galaxia', admin: 'galaxia' });
    render(<ThemeProvider><TestConsumer /></ThemeProvider>);
    await vi.waitFor(() => expect(mockedFetchTheme).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('active-theme').textContent).toBe('galaxia');

    // Server now reports a different frontend theme.
    mockedFetchTheme.mockResolvedValue({ frontend: 'dnd', admin: 'galaxia' });
    await act(async () => {
      __emitChannelForTests('content-changed', { theme: true });
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId('active-theme').textContent).toBe('dnd');
    });
    expect(mockedFetchTheme).toHaveBeenCalledTimes(2);
    // The change runs the repaint pulse (forces a WebKit/iPad repaint).
    expect(document.documentElement.classList.contains('theme-reload-pulse')).toBe(true);
  });

  it('does not pulse when the re-fetched theme is unchanged (own-echo guard)', async () => {
    mockedFetchTheme.mockResolvedValue({ frontend: 'galaxia', admin: 'galaxia' });
    render(<ThemeProvider><TestConsumer /></ThemeProvider>);
    await vi.waitFor(() => expect(mockedFetchTheme).toHaveBeenCalledTimes(1));

    await act(async () => {
      __emitChannelForTests('content-changed', { theme: true });
    });

    await vi.waitFor(() => expect(mockedFetchTheme).toHaveBeenCalledTimes(2));
    expect(document.documentElement.classList.contains('theme-reload-pulse')).toBe(false);
    expect(screen.getByTestId('active-theme').textContent).toBe('galaxia');
  });

  it('applies an admin (gamemaster) theme change with the repaint pulse', async () => {
    mockedFetchTheme.mockResolvedValue({ frontend: 'galaxia', admin: 'galaxia' });
    render(<ThemeProvider rootTheme="admin"><TestConsumer /></ThemeProvider>);
    await vi.waitFor(() => expect(mockedFetchTheme).toHaveBeenCalledTimes(1));
    expect(document.documentElement.dataset.theme).toBe('galaxia');

    // Admin changes the admin theme elsewhere → the GM receives content-changed.
    mockedFetchTheme.mockResolvedValue({ frontend: 'galaxia', admin: 'dnd' });
    await act(async () => {
      __emitChannelForTests('content-changed', { theme: true });
    });

    await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe('dnd'));
    // The repaint pulse forces WebKit/Safari (iPad GM) to repaint the atmosphere
    // and custom-property colors so they don't stay stale until a manual reload.
    expect(document.documentElement.classList.contains('theme-reload-pulse')).toBe(true);
  });

  it('ignores a content-changed without the theme flag', async () => {
    mockedFetchTheme.mockResolvedValue({ frontend: 'galaxia', admin: 'galaxia' });
    render(<ThemeProvider><TestConsumer /></ThemeProvider>);
    await vi.waitFor(() => expect(mockedFetchTheme).toHaveBeenCalledTimes(1));

    await act(async () => {
      __emitChannelForTests('content-changed', { config: true });
    });

    expect(mockedFetchTheme).toHaveBeenCalledTimes(1);
  });
});
