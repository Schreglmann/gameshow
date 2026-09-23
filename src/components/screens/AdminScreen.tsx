import { useState, useEffect, useCallback } from 'react';
import type { AssetCategory } from '@/types/config';
import { useTheme } from '@/context/ThemeContext';
import SessionTab from '@/components/backend/SessionTab';
import GamesTab from '@/components/backend/GamesTab';
import ConfigTab from '@/components/backend/ConfigTab';
import GameshowsTab from '@/components/backend/GameshowsTab';
import NavIcon from '@/components/backend/AdminNavIcons';
import AssetsTab from '@/components/backend/AssetsTab';
import SystemTab from '@/components/backend/SystemTab';
import AnswersTab from '@/components/backend/AnswersTab';
import { UploadProvider } from '@/components/backend/UploadContext';
import { SpellcheckSettingsProvider } from '@/components/backend/SpellcheckSettingsContext';
import LektoratTab from '@/components/backend/LektoratTab';
import SaveStatusIndicator from '@/components/backend/SaveStatusIndicator';
import ProgressOverlay from '@/components/backend/ProgressOverlay';
import '@/admin.css';
import '@/backend.css';

type Tab = 'session' | 'games' | 'config' | 'gameshows' | 'assets' | 'system' | 'answers' | 'spellcheck';

const TABS: { id: Tab; label: string }[] = [
  { id: 'session', label: 'Session' },
  { id: 'config', label: 'Config' },
  { id: 'gameshows', label: 'Gameshows' },
  { id: 'games', label: 'Spiele' },
  { id: 'assets', label: 'Assets' },
];

const VALID_TABS = new Set<Tab>(['session', 'games', 'config', 'gameshows', 'assets', 'system', 'answers', 'spellcheck']);
const VALID_ASSET_CATEGORIES = new Set<string>(['images', 'audio', 'background-music', 'videos']);

function parseHash(): { tab: Tab; file?: string; instance?: string; assetCategory?: AssetCategory } {
  const parts = window.location.hash.slice(1).split('/');
  const tab = (VALID_TABS.has(parts[0] as Tab) ? parts[0] : 'session') as Tab;
  const part1 = parts[1] ? decodeURIComponent(parts[1]) : undefined;
  return {
    tab,
    file: part1,
    instance: parts[2] ? decodeURIComponent(parts[2]) : undefined,
    assetCategory: (part1 && VALID_ASSET_CATEGORIES.has(part1)) ? part1 as AssetCategory : undefined,
  };
}

export default function AdminScreen() {
  return (
    <UploadProvider>
      <SpellcheckSettingsProvider>
        <AdminScreenInner />
      </SpellcheckSettingsProvider>
    </UploadProvider>
  );
}

function AdminScreenInner() {
  const { adminTheme } = useTheme();
  const initial = parseHash();
  const [activeTab, setActiveTab] = useState<Tab>(initial.tab);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [gamesKey, setGamesKey] = useState(0);
  const [gamesNav, setGamesNav] = useState<{ file?: string; instance?: string; questionIndex?: number }>(
    initial.tab === 'games' ? { file: initial.file, instance: initial.instance } : {}
  );
  const [assetsCategory, setAssetsCategory] = useState<AssetCategory>(
    initial.tab === 'assets' && initial.assetCategory ? initial.assetCategory : 'images'
  );
  // Sync state → hash (only if different)
  useEffect(() => {
    const parts: string[] = [activeTab];
    if (activeTab === 'games' && gamesNav.file) {
      parts.push(encodeURIComponent(gamesNav.file));
      if (gamesNav.instance) parts.push(encodeURIComponent(gamesNav.instance));
    } else if (activeTab === 'assets') {
      parts.push(encodeURIComponent(assetsCategory));
    }
    const target = '#' + parts.join('/');
    if (window.location.hash !== target) {
      window.location.hash = parts.join('/');
    }
  }, [activeTab, gamesNav, assetsCategory]);

  // Sync hash → state (browser back/forward)
  const syncFromHash = useCallback(() => {
    const parsed = parseHash();
    setActiveTab(parsed.tab);
    if (parsed.tab === 'games') {
      setGamesNav(parsed.file ? { file: parsed.file, instance: parsed.instance } : {});
    } else if (parsed.tab === 'assets' && parsed.assetCategory) {
      setAssetsCategory(parsed.assetCategory);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, [syncFromHash]);

  const switchTab = (tab: Tab) => {
    if (tab === 'games') {
      setGamesKey(k => k + 1);
      setGamesNav({});
    }
    setActiveTab(tab);
    setSidebarOpen(false);
  };

  const handleGamesNavigate = (file: string | null, instance?: string, questionIndex?: number) => {
    setGamesNav(file ? { file, instance, questionIndex } : {});
  };

  const handleAssetNavigateToGame = (fileName: string, instance?: string, questionIndex?: number) => {
    setGamesKey(k => k + 1);
    setGamesNav({ file: fileName, instance, questionIndex });
    setActiveTab('games');
    setSidebarOpen(false);
  };

  return (
    <div className="admin-shell" data-theme={adminTheme}>
      <button className="hamburger-btn" onClick={() => setSidebarOpen(true)} aria-label="Menü öffnen">☰</button>
      <div className={`sidebar-backdrop${sidebarOpen ? ' open' : ''}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`admin-sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="admin-sidebar-header">
          <span className="admin-sidebar-title">Admin</span>
          <a href="/show/" className="admin-back-link">← Home</a>
        </div>
        <nav className="admin-nav">
          <a href="/show/" className="admin-nav-item admin-nav-home" onClick={() => setSidebarOpen(false)}>
            <span className="admin-nav-icon"><NavIcon name="home" /></span>
            <span>Home</span>
          </a>
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`admin-nav-item ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => switchTab(tab.id)}
            >
              <span className="admin-nav-icon"><NavIcon name={tab.id} /></span>
              <span>{tab.label}</span>
            </button>
          ))}
          <div className="admin-nav-divider" />
          <button
            className={`admin-nav-item ${activeTab === 'answers' ? 'active' : ''}`}
            onClick={() => switchTab('answers')}
          >
            <span className="admin-nav-icon"><NavIcon name="answers" /></span>
            <span>Antworten</span>
          </button>
          <button
            className={`admin-nav-item ${activeTab === 'spellcheck' ? 'active' : ''}`}
            onClick={() => switchTab('spellcheck')}
          >
            <span className="admin-nav-icon"><NavIcon name="spellcheck" /></span>
            <span>Korrektur</span>
          </button>
          <div className="admin-nav-spacer" />
          <button
            className={`admin-nav-item ${activeTab === 'system' ? 'active' : ''}`}
            onClick={() => switchTab('system')}
          >
            <span className="admin-nav-icon"><NavIcon name="system" /></span>
            <span>System</span>
          </button>
        </nav>
      </aside>

      <main className="admin-main">
        {activeTab === 'session' && <div className="admin-tab-pane"><SessionTab /></div>}
        {activeTab === 'answers' && <div className="admin-tab-pane admin-tab-pane--flush"><AnswersTab /></div>}
        {activeTab === 'games' && (
          <div className="admin-tab-pane">
            <GamesTab
              key={gamesKey}
              onGoToAssets={() => switchTab('assets')}
              initialFile={gamesNav.file}
              initialInstance={gamesNav.instance}
              initialQuestion={gamesNav.questionIndex}
              onNavigate={handleGamesNavigate}
            />
          </div>
        )}
        {activeTab === 'config' && <div className="admin-tab-pane"><ConfigTab /></div>}
        {activeTab === 'gameshows' && <div className="admin-tab-pane"><GameshowsTab /></div>}
        {activeTab === 'assets' && (
          <div className="admin-tab-pane">
            <AssetsTab initialCategory={assetsCategory} onCategoryChange={setAssetsCategory} onNavigateToGame={handleAssetNavigateToGame} />
          </div>
        )}
        {activeTab === 'system' && <div className="admin-tab-pane"><SystemTab /></div>}
        {activeTab === 'spellcheck' && (
          <div className="admin-tab-pane"><LektoratTab onNavigateToGame={handleAssetNavigateToGame} /></div>
        )}
      </main>
      <ProgressOverlay />
      {/* Outside every pane on purpose: the panes unmount on a tab switch, and the
          whole point of this is to keep reporting a save that outlived the pane that
          queued it. Renders into the shared bottom-right toast stack — see
          specs/admin-save-queue.md. */}
      <SaveStatusIndicator />
    </div>
  );
}
