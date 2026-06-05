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
    // `deepsea` is one of the curated admin themes (ADMIN_THEME_IDS); a theme
    // outside that subset would be rejected by the admin validation guard.
    mockedFetchTheme.mockResolvedValue({ frontend: 'galaxia', admin: 'deepsea' });
    await act(async () => {
      __emitChannelForTests('content-changed', { theme: true });
    });

    await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe('deepsea'));
    // The repaint pulse forces WebKit/Safari (iPad GM) to repaint the atmosphere
    // and custom-property colors so they don't stay stale until a manual reload.
    expect(document.documentElement.classList.contains('theme-reload-pulse')).toBe(true);
  });

  it('ignores a server admin theme outside the curated subset (falls back to default)', async () => {
    // harry-potter is a frontend-only theme; the admin selector exposes only
    // galaxia/deepsea/enterprise, so a stale/legacy admin value is rejected and
    // the admin theme stays on the default (galaxia).
    mockedFetchTheme.mockResolvedValue({ frontend: 'galaxia', admin: 'harry-potter' });
    render(<ThemeProvider rootTheme="admin"><TestConsumer /></ThemeProvider>);
    await vi.waitFor(() => expect(mockedFetchTheme).toHaveBeenCalledTimes(1));
    expect(document.documentElement.dataset.theme).toBe('galaxia');
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
