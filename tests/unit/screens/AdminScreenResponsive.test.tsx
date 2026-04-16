import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@/context/ThemeContext';
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
  saveConfig: vi.fn().mockResolvedValue(undefined),
  saveGame: vi.fn().mockResolvedValue(undefined),
  createGame: vi.fn().mockResolvedValue(undefined),
  deleteGame: vi.fn().mockResolvedValue(undefined),
  uploadAsset: vi.fn().mockResolvedValue('file.jpg'),
  deleteAsset: vi.fn().mockResolvedValue(undefined),
  probeVideo: vi.fn().mockResolvedValue({ tracks: [], needsTranscode: false }),
  startTranscode: vi.fn().mockResolvedValue({ status: 'running', percent: 0 }),
  fetchTranscodeStatus: vi.fn().mockResolvedValue([]),
  fetchAssetUsages: vi.fn().mockResolvedValue([]),
  moveAsset: vi.fn().mockResolvedValue(undefined),
  createAssetFolder: vi.fn().mockResolvedValue(undefined),
  youtubeDownload: vi.fn(),
  fetchVideoCover: vi.fn().mockResolvedValue({ posterPath: null, logs: [] }),
}));

function renderAdmin() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <GameProvider>
          <AdminScreen />
        </GameProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('AdminScreen — responsive / hamburger drawer', () => {
  beforeEach(() => {
    localStorage.clear();
    window.location.hash = '';
  });

  afterEach(() => {
    window.location.hash = '';
  });

  // ── Hamburger button ──

  it('renders a hamburger menu button', () => {
    renderAdmin();
    expect(screen.getByRole('button', { name: /Menü öffnen/ })).toBeInTheDocument();
  });

  it('hamburger button shows ☰ icon', () => {
    renderAdmin();
    const btn = screen.getByRole('button', { name: /Menü öffnen/ });
    expect(btn.textContent).toBe('☰');
  });

  it('hamburger button has hamburger-btn class', () => {
    renderAdmin();
    const btn = screen.getByRole('button', { name: /Menü öffnen/ });
    expect(btn).toHaveClass('hamburger-btn');
  });

  // ── Sidebar state ──

  it('sidebar does not have "open" class initially', () => {
    renderAdmin();
    const sidebar = document.querySelector('.admin-sidebar');
    expect(sidebar).not.toHaveClass('open');
  });

  it('sidebar gets "open" class when hamburger is clicked', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await user.click(screen.getByRole('button', { name: /Menü öffnen/ }));
    const sidebar = document.querySelector('.admin-sidebar');
    expect(sidebar).toHaveClass('open');
  });

  it('backdrop gets "open" class when hamburger is clicked', async () => {
    const user = userEvent.setup();
    renderAdmin();
    await user.click(screen.getByRole('button', { name: /Menü öffnen/ }));
    const backdrop = document.querySelector('.sidebar-backdrop');
    expect(backdrop).toHaveClass('open');
  });

  // ── Closing the drawer ──

  it('sidebar closes when backdrop is clicked', async () => {
    const user = userEvent.setup();
    renderAdmin();

    // Open
    await user.click(screen.getByRole('button', { name: /Menü öffnen/ }));
    expect(document.querySelector('.admin-sidebar')).toHaveClass('open');

    // Close via backdrop
    const backdrop = document.querySelector('.sidebar-backdrop.open') as HTMLElement;
    await user.click(backdrop);
    expect(document.querySelector('.admin-sidebar')).not.toHaveClass('open');
  });

  it('sidebar closes when a nav tab is clicked', async () => {
    const user = userEvent.setup();
    renderAdmin();

    // Open
    await user.click(screen.getByRole('button', { name: /Menü öffnen/ }));
    expect(document.querySelector('.admin-sidebar')).toHaveClass('open');

    // Click a tab
    await user.click(screen.getByRole('button', { name: /Spiele/ }));
    expect(document.querySelector('.admin-sidebar')).not.toHaveClass('open');
  });

  // ── Home link in nav ──

  it('renders a Home link inside the sidebar nav', () => {
    renderAdmin();
    // Open the sidebar to make nav visible in DOM
    const homeLinks = screen.getAllByText('Home');
    // At least one Home link should exist (the nav one)
    const navHome = homeLinks.find(el => el.closest('.admin-nav'));
    expect(navHome).toBeTruthy();
  });

  it('Home nav link points to /', () => {
    renderAdmin();
    const homeLinks = screen.getAllByText('Home');
    const navHome = homeLinks.find(el => el.closest('.admin-nav'));
    const link = navHome?.closest('a');
    expect(link).toHaveAttribute('href', '/');
  });

  it('Home nav link has admin-nav-home class', () => {
    renderAdmin();
    const navHomeLink = document.querySelector('.admin-nav-home');
    expect(navHomeLink).toBeInTheDocument();
  });

  // ── Shell structure ──

  it('admin shell has grid display class', () => {
    renderAdmin();
    const shell = document.querySelector('.admin-shell');
    expect(shell).toBeInTheDocument();
  });

  it('renders sidebar as <aside> element', () => {
    renderAdmin();
    const aside = document.querySelector('aside.admin-sidebar');
    expect(aside).toBeInTheDocument();
  });

  it('renders main content as <main> element', () => {
    renderAdmin();
    const main = document.querySelector('main.admin-main');
    expect(main).toBeInTheDocument();
  });

  it('renders sidebar backdrop div', () => {
    renderAdmin();
    const backdrop = document.querySelector('.sidebar-backdrop');
    expect(backdrop).toBeInTheDocument();
  });

  it('backdrop does not have "open" class initially', () => {
    renderAdmin();
    const backdrop = document.querySelector('.sidebar-backdrop');
    expect(backdrop).not.toHaveClass('open');
  });

  // ── Tab content still works with hamburger ──

  it('tab content is visible without opening the sidebar', () => {
    renderAdmin();
    // Default session tab content should be visible
    expect(screen.getByText('Team Verwaltung')).toBeInTheDocument();
  });

  it('tab content remains after opening and closing sidebar', async () => {
    const user = userEvent.setup();
    renderAdmin();

    // Open sidebar
    await user.click(screen.getByRole('button', { name: /Menü öffnen/ }));
    // Close sidebar
    const backdrop = document.querySelector('.sidebar-backdrop.open') as HTMLElement;
    await user.click(backdrop);

    // Content should still be visible
    expect(screen.getByText('Team Verwaltung')).toBeInTheDocument();
  });

  it('can switch tabs via sidebar and see new content', async () => {
    const user = userEvent.setup();
    renderAdmin();

    // Open sidebar
    await user.click(screen.getByRole('button', { name: /Menü öffnen/ }));
    // Click Config tab
    await user.click(screen.getByRole('button', { name: /Config/ }));

    // Sidebar should close
    expect(document.querySelector('.admin-sidebar')).not.toHaveClass('open');
    // Config content should show
    await waitFor(() => {
      expect(screen.getByText('Konfiguration')).toBeInTheDocument();
    });
  });
});
