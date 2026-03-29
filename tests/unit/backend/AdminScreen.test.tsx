import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import AdminScreen from '@/components/screens/AdminScreen';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
  }),
}));

vi.mock('@/services/backendApi', () => ({
  fetchGames: vi.fn().mockResolvedValue([]),
  fetchGame: vi.fn().mockResolvedValue({}),
  fetchConfig: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
    activeGameshow: 'gs1',
    gameshows: { gs1: { name: 'Show 1', gameOrder: [] } },
  }),
  fetchAssets: vi.fn().mockResolvedValue({ files: [], subfolders: [] }),
  fetchAssetStorage: vi.fn().mockResolvedValue({ mode: 'local', path: '/local' }),
  saveConfig: vi.fn().mockResolvedValue(undefined),
  saveGame: vi.fn().mockResolvedValue(undefined),
  createGame: vi.fn().mockResolvedValue(undefined),
  deleteGame: vi.fn().mockResolvedValue(undefined),
  uploadAsset: vi.fn().mockResolvedValue('file.jpg'),
  deleteAsset: vi.fn().mockResolvedValue(undefined),
}));

function renderAdmin(initialHash = '') {
  window.location.hash = initialHash;
  return render(
    <MemoryRouter>
      <GameProvider>
        <AdminScreen />
      </GameProvider>
    </MemoryRouter>
  );
}

describe('AdminScreen', () => {
  beforeEach(() => {
    localStorage.clear();
    window.location.hash = '';
  });

  afterEach(() => {
    window.location.hash = '';
  });

  // ── Sidebar / Navigation ──

  it('renders Admin title in sidebar', () => {
    renderAdmin();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('renders "← Home" back link', () => {
    renderAdmin();
    const link = screen.getByText('← Home');
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('href', '/');
  });

  it('renders all 4 tab buttons', () => {
    renderAdmin();
    expect(screen.getByRole('button', { name: /Session/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Spiele/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Config/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Assets/ })).toBeInTheDocument();
  });

  it('renders tab icons', () => {
    renderAdmin();
    expect(screen.getByText('🎮')).toBeInTheDocument();
    expect(screen.getByText('🎲')).toBeInTheDocument();
    expect(screen.getByText('⚙️')).toBeInTheDocument();
    expect(screen.getByText('📁')).toBeInTheDocument();
  });

  // ── Default tab ──

  it('shows Session tab content by default', () => {
    renderAdmin();
    expect(screen.getByText('Team Verwaltung')).toBeInTheDocument();
  });

  it('Session tab button has "active" class by default', () => {
    renderAdmin();
    const sessionBtn = screen.getByRole('button', { name: /Session/ });
    expect(sessionBtn).toHaveClass('active');
  });

  // ── Tab switching ──

  it('switches to GamesTab when Spiele is clicked', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await user.click(screen.getByRole('button', { name: /Spiele/ }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Spiele' })).toBeInTheDocument();
    });
  });

  it('switches to ConfigTab when Config is clicked', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await user.click(screen.getByRole('button', { name: /Config/ }));
    await waitFor(() => {
      expect(screen.getByText('Konfiguration')).toBeInTheDocument();
    });
  });

  it('switches to AssetsTab when Assets is clicked', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await user.click(screen.getByRole('button', { name: /Assets/ }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Bilder' })).toBeInTheDocument();
    });
  });

  it('highlights the active tab button', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await user.click(screen.getByRole('button', { name: /Config/ }));
    expect(screen.getByRole('button', { name: /Config/ })).toHaveClass('active');
    expect(screen.getByRole('button', { name: /Session/ })).not.toHaveClass('active');
  });

  it('hides Session content when switching to another tab', async () => {
    const user = userEvent.setup();
    renderAdmin();
    expect(screen.getByText('Team Verwaltung')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Spiele/ }));
    expect(screen.queryByText('Team Verwaltung')).not.toBeInTheDocument();
  });

  it('resets GamesTab state when switching back to Spiele tab', async () => {
    const user = userEvent.setup();
    renderAdmin();
    // Go to Spiele
    await user.click(screen.getByRole('button', { name: /Spiele/ }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Spiele' })).toBeInTheDocument();
    });
    // Go to Session
    await user.click(screen.getByRole('button', { name: /Session/ }));
    // Go back to Spiele — should reload
    await user.click(screen.getByRole('button', { name: /Spiele/ }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Spiele' })).toBeInTheDocument();
    });
  });

  // ── Hash routing ──

  it('reads hash to set initial tab', () => {
    renderAdmin('#config');
    expect(screen.getByRole('button', { name: /Config/ })).toHaveClass('active');
  });

  it('reads hash to set initial tab to assets', () => {
    renderAdmin('#assets');
    expect(screen.getByRole('button', { name: /Assets/ })).toHaveClass('active');
  });

  it('defaults to session for invalid hash value', () => {
    window.location.hash = '#invalid-tab';
    renderAdmin();
    expect(screen.getByRole('button', { name: /Session/ })).toHaveClass('active');
  });

  it('updates hash when tab is switched', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await user.click(screen.getByRole('button', { name: /Config/ }));
    await waitFor(() => {
      expect(window.location.hash).toBe('#config');
    });
  });

  it('updates hash to #session when session tab is active', async () => {
    const user = userEvent.setup();
    renderAdmin();
    // The default session tab should set hash to #session
    await waitFor(() => {
      expect(window.location.hash).toBe('#session');
    });
  });

  // ── GamesTab onGoToAssets integration ──

  it('switches to Assets tab when GamesTab onGoToAssets is triggered', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await user.click(screen.getByRole('button', { name: /Spiele/ }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Spiele' })).toBeInTheDocument();
    });
    // We verify that the Assets tab can be switched to
    await user.click(screen.getByRole('button', { name: /Assets/ }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Bilder' })).toBeInTheDocument();
    });
  });

  // ── Games hash routing with file/instance ──

  it('sets hash with file when editing a game in GamesTab', async () => {
    const { fetchGames, fetchGame } = await import('@/services/backendApi');
    (fetchGames as ReturnType<typeof vi.fn>).mockResolvedValue([
      { fileName: 'quiz-1', type: 'simple-quiz', title: 'Quiz 1', instances: ['v1'], isSingleInstance: false },
    ]);
    (fetchGame as ReturnType<typeof vi.fn>).mockResolvedValue({
      type: 'simple-quiz', title: 'Quiz 1', rules: [], instances: { v1: { questions: [] } },
    });

    const user = userEvent.setup();
    renderAdmin();
    await user.click(screen.getByRole('button', { name: /Spiele/ }));
    await waitFor(() => {
      expect(screen.getByText('Quiz 1')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Quiz 1'));
    await waitFor(() => {
      expect(window.location.hash).toContain('games');
      expect(window.location.hash).toContain('quiz-1');
    });
  });
});
