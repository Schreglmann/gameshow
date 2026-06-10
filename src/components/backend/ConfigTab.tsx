import { useTheme, THEMES, ADMIN_THEMES } from '@/context/ThemeContext';
import RulesEditor from './RulesEditor';
import StatusMessage from './StatusMessage';
import ConflictBanner from './ConflictBanner';
import { useEditableConfig } from './useEditableConfig';

const THEME_GRADIENTS: Record<string, [string, string]> = {
  galaxia: ['#4a5bc4', '#5a3585'],
  'harry-potter': ['#1c0b2e', '#2a0e3a'],
  dnd: ['#161009', '#b8860b'],
  enterprise: ['#0f172a', '#1e293b'],
  retro: ['#000000', '#1a1a2e'],
  minecraft: ['#7cb9ff', '#5fb932'],
  'classical-music': ['#f4ecd8', '#7a1a2e'],
  'modern-music': ['#0a0a14', '#ff00aa'],
  'movie-quiz': ['#1a0a0d', '#f5c518'],
  deepsea: ['#021a26', '#2dd4bf'],
};

export default function ConfigTab() {
  const { theme, setTheme, adminTheme, setAdminTheme } = useTheme();
  const { config, setConfig, loading, message, conflict, adoptRemote, dismissConflict } = useEditableConfig();

  if (loading) return <div className="be-loading">Lade Config...</div>;
  if (!config) return <div className="be-loading">Config konnte nicht geladen werden.</div>;

  return (
    <div>
      <div className="tab-toolbar" style={{ marginBottom: 14 }}>
        <h2 className="tab-title">Konfiguration</h2>
      </div>

      <StatusMessage message={message} />

      {conflict && (
        <ConflictBanner
          what="Die Konfiguration"
          onReload={() => adoptRemote(conflict.fresh)}
          onDismiss={dismissConflict}
        />
      )}

      {/* Themes */}
      <div className="backend-card" style={{ position: 'relative' }}>
        <a href="/show/theme-showcase" className="be-icon-btn" style={{ position: 'absolute', top: 12, right: 14, textDecoration: 'none' }}>Vorschau aller Komponenten →</a>
        <h3>Themes</h3>
        <div style={{ fontSize: 'var(--admin-sz-12, 12px)', color: 'rgba(var(--text-rgb), 0.5)', textAlign: 'center', marginTop: 18, marginBottom: 8 }}>Gameshow</div>
        <div className="theme-selector">
          {THEMES.map(t => {
            const [from, to] = THEME_GRADIENTS[t.id]!;
            return (
              <button
                key={t.id}
                className={`theme-option${theme === t.id ? ' active' : ''}`}
                onClick={() => setTheme(t.id)}
              >
                <div
                  className="theme-preview"
                  style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
                />
                <span className="theme-name">{t.label}</span>
                <span className="theme-desc">{t.description}</span>
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 'var(--admin-sz-12, 12px)', color: 'rgba(var(--text-rgb), 0.5)', textAlign: 'center', marginTop: 18, marginBottom: 8 }}>Admin</div>
        <div className="theme-selector">
          {ADMIN_THEMES.map(t => {
            const [from, to] = THEME_GRADIENTS[t.id]!;
            return (
              <button
                key={t.id}
                className={`theme-option${adminTheme === t.id ? ' active' : ''}`}
                onClick={() => setAdminTheme(t.id)}
              >
                <div
                  className="theme-preview"
                  style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
                />
                <span className="theme-name">{t.label}</span>
                <span className="theme-desc">{t.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Global settings */}
      <div className="backend-card">
        <h3>Globale Einstellungen</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
          <label className="be-toggle">
            <input
              type="checkbox"
              checked={config.pointSystemEnabled !== false}
              onChange={e => setConfig({ ...config, pointSystemEnabled: e.target.checked })}
            />
            <span className="be-toggle-track" />
            <span className="be-toggle-label">Punktesystem aktiviert</span>
          </label>
          <label className="be-toggle">
            <input
              type="checkbox"
              checked={config.teamRandomizationEnabled !== false}
              onChange={e => setConfig({ ...config, teamRandomizationEnabled: e.target.checked })}
            />
            <span className="be-toggle-track" />
            <span className="be-toggle-label">Team-Randomisierung aktiviert</span>
          </label>
          <label className="be-toggle">
            <input
              type="checkbox"
              checked={config.jokersInLastGame === true}
              onChange={e => setConfig({ ...config, jokersInLastGame: e.target.checked })}
            />
            <span className="be-toggle-track" />
            <span className="be-toggle-label">Joker im letzten Spiel erlauben</span>
          </label>
        </div>
      </div>

      {/* Global rules */}
      <div className="backend-card">
        <h3>Globale Regeln</h3>
        <RulesEditor
          rules={config.globalRules ?? []}
          onChange={rules => setConfig({ ...config, globalRules: rules })}
          placeholder="Neue globale Regel..."
        />
      </div>
    </div>
  );
}
