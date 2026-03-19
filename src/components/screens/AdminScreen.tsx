import { useState } from 'react';
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

export default function AdminScreen() {
  const [activeTab, setActiveTab] = useState<Tab>('session');
  const [gamesKey, setGamesKey] = useState(0);

  const switchTab = (tab: Tab) => {
    if (tab === 'games') setGamesKey(k => k + 1);
    setActiveTab(tab);
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
        {activeTab === 'games' && <div className="admin-tab-pane"><GamesTab key={gamesKey} onGoToAssets={() => switchTab('assets')} /></div>}
        {activeTab === 'config' && <div className="admin-tab-pane"><ConfigTab /></div>}
        {activeTab === 'assets' && <div className="admin-tab-pane"><AssetsTab /></div>}
      </main>
    </div>
  );
}
