import { useTheme, THEMES, ADMIN_THEMES, THEME_SWATCHES } from '@/context/ThemeContext';
import RulesEditor from './RulesEditor';
import StatusMessage from './StatusMessage';
import ConflictBanner from './ConflictBanner';
import { useEditableConfig } from './useEditableConfig';
import { GENERIC_JOKER_RULES } from '@/data/jokers';

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
        <div style={{ fontSize: 'var(--admin-sz-12, 12px)', color: 'rgba(var(--text-rgb), max(0.5, var(--text-fade-floor, 0)))', textAlign: 'center', marginTop: 18, marginBottom: 8 }}>Gameshow</div>
        <div className="theme-selector">
          {THEMES.map(t => {
            return (
              <button
                key={t.id}
                className={`theme-option${theme === t.id ? ' active' : ''}`}
                onClick={() => setTheme(t.id)}
              >
                <div
                  className="theme-preview"
                  style={{ background: THEME_SWATCHES[t.id] }}
                />
                <span className="theme-name">{t.label}</span>
                <span className="theme-desc">{t.description}</span>
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 'var(--admin-sz-12, 12px)', color: 'rgba(var(--text-rgb), max(0.5, var(--text-fade-floor, 0)))', textAlign: 'center', marginTop: 18, marginBottom: 8 }}>Admin</div>
        <div className="theme-selector">
          {ADMIN_THEMES.map(t => {
            return (
              <button
                key={t.id}
                className={`theme-option${adminTheme === t.id ? ' active' : ''}`}
                onClick={() => setAdminTheme(t.id)}
              >
                <div
                  className="theme-preview"
                  style={{ background: THEME_SWATCHES[t.id] }}
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
          <label
            className="be-toggle"
            title="Der Gamemaster steht dem Publikum gegenüber, daher werden die Teams auf dem Gamemaster gespiegelt dargestellt. Zusätzlich lässt sich mit „Teams tauschen“ festlegen, welches Team links steht. Diese Option schaltet beides ab."
          >
            <input
              type="checkbox"
              checked={config.teamMirrorEnabled !== false}
              onChange={e => setConfig({ ...config, teamMirrorEnabled: e.target.checked })}
            />
            <span className="be-toggle-track" />
            <span className="be-toggle-label">Team-Spiegelung &amp; Seitenwechsel (Gamemaster)</span>
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
          <label
            className="be-toggle"
            title="Standardmäßig kann jedes Team jeden Joker nur einmal pro Gameshow einsetzen. Ist diese Option aktiv, stehen zu Beginn jedes Spiels alle Joker wieder zur Verfügung – nur der Aufholjoker bleibt einmalig pro Show."
          >
            <input
              type="checkbox"
              checked={config.jokerUsageScope === 'per-game'}
              onChange={e => setConfig({ ...config, jokerUsageScope: e.target.checked ? 'per-game' : 'per-gameshow' })}
            />
            <span className="be-toggle-track" />
            <span className="be-toggle-label">Joker pro Spiel zurücksetzen</span>
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

      {/* Joker rules — generic joker explanation shown in the Regelwerk when the
          active gameshow has jokers enabled. Prefilled with the built-in default
          so the operator edits the current text rather than starting blank. */}
      <div className="backend-card">
        <h3>Joker-Regeln</h3>
        <p style={{ fontSize: 'var(--admin-sz-12, 12px)', color: 'rgba(var(--text-rgb), max(0.5, var(--text-fade-floor, 0)))', marginTop: 0, marginBottom: 12 }}>
          Erscheinen im Regelwerk, sobald die aktive Gameshow Joker aktiviert hat.
        </p>
        <RulesEditor
          rules={config.jokerRules ?? [...GENERIC_JOKER_RULES]}
          onChange={rules => setConfig({ ...config, jokerRules: rules })}
          placeholder="Neue Joker-Regel..."
        />
      </div>
    </div>
  );
}
