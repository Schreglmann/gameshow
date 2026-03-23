import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import SessionTab from '@/components/backend/SessionTab';
import GamesTab from '@/components/backend/GamesTab';
import ConfigTab from '@/components/backend/ConfigTab';
import AssetsTab from '@/components/backend/AssetsTab';
import '@/admin.css';
import '@/backend.css';

type Tab = 'session' | 'games' | 'config' | 'assets';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'session', label: 'Session', icon: '🎮' },
  { id: 'games', label: 'Spiele', icon: '🎲' },
  { id: 'config', label: 'Config', icon: '⚙️' },
  { id: 'assets', label: 'Assets', icon: '📁' },
];

const VALID_TABS = new Set<Tab>(['session', 'games', 'config', 'assets']);

function parseHash(): { tab: Tab; file?: string; instance?: string } {
  const parts = window.location.hash.slice(1).split('/');
  const tab = (VALID_TABS.has(parts[0] as Tab) ? parts[0] : 'session') as Tab;
  return {
    tab,
    file: parts[1] ? decodeURIComponent(parts[1]) : undefined,
    instance: parts[2] ? decodeURIComponent(parts[2]) : undefined,
  };
}

export default function AdminScreen() {
  const initial = parseHash();
  const [activeTab, setActiveTab] = useState<Tab>(initial.tab);
  const [gamesKey, setGamesKey] = useState(0);
  const [gamesNav, setGamesNav] = useState<{ file?: string; instance?: string }>(
    initial.tab === 'games' ? { file: initial.file, instance: initial.instance } : {}
  );

  useEffect(() => {
    const parts: string[] = [activeTab];
    if (activeTab === 'games' && gamesNav.file) {
      parts.push(encodeURIComponent(gamesNav.file));
      if (gamesNav.instance) parts.push(encodeURIComponent(gamesNav.instance));
    }
    window.location.hash = parts.join('/');
  }, [activeTab, gamesNav]);

  const switchTab = (tab: Tab) => {
    if (tab === 'games') {
      setGamesKey(k => k + 1);
      setGamesNav({});
    }
    setActiveTab(tab);
  };

  const handleGamesNavigate = (file: string | null, instance?: string) => {
    setGamesNav(file ? { file, instance } : {});
  };

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-header">
          <span className="admin-sidebar-title">Admin</span>
          <Link to="/" className="admin-back-link">← Home</Link>
        </div>
        <nav className="admin-nav">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`admin-nav-item ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => switchTab(tab.id)}
            >
              <span className="admin-nav-icon">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="admin-main">
        {activeTab === 'session' && <div className="admin-tab-pane"><SessionTab /></div>}
        {activeTab === 'games' && (
          <div className="admin-tab-pane">
            <GamesTab
              key={gamesKey}
              onGoToAssets={() => switchTab('assets')}
              initialFile={gamesNav.file}
              initialInstance={gamesNav.instance}
              onNavigate={handleGamesNavigate}
            />
          </div>
        )}
        {activeTab === 'config' && <div className="admin-tab-pane"><ConfigTab /></div>}
        {activeTab === 'assets' && <div className="admin-tab-pane"><AssetsTab /></div>}
      </main>
    </div>
  );
}
