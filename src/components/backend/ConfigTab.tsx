import { useState } from 'react';
import { useTheme, THEMES, ADMIN_THEMES, THEME_SWATCHES } from '@/context/ThemeContext';
import RulesEditor from './RulesEditor';
import StatusMessage from './StatusMessage';
import ConflictBanner from './ConflictBanner';
import { useEditableConfig } from './useEditableConfig';
import { GENERIC_JOKER_RULES } from '@/data/jokers';
import { ALL_TEAM_KEYS, DEFAULT_TEAM_COUNT, normalizeTeamCount, teamNumber } from '@/utils/teams';
import { DEFAULT_TEAM_COLORS } from '@/utils/teamColors';
import ColorPickerField from './ColorPickerField';
import { ALL_POINT_MODES, pointModeLabel, POINT_MODE_RULE_DEFAULTS } from '@/utils/pointMode';
import { DEFAULT_SHOW_TITLE } from '@/utils/showTitle';

export default function ConfigTab() {
  const { theme, setTheme, adminTheme, setAdminTheme } = useTheme();
  const { config, setConfig, loading, message, conflict, adoptRemote, dismissConflict } = useEditableConfig();
  // Rejected hex input. Local rather than routed through `useEditableConfig`,
  // whose message channel reports save status. See specs/team-colors.md.
  const [colorError, setColorError] = useState<string | null>(null);

  if (loading) return <div className="be-loading">Lade Config...</div>;
  if (!config) return <div className="be-loading">Config konnte nicht geladen werden.</div>;

  // The active gameshow's team count OVERRIDES two of the global switches below,
  // so they are shown at their effective value and locked rather than silently
  // contradicting the running show:
  //   0 teams → nothing can be scored, so the point system is off.
  //   0-1 teams → there is no second team to split players between, so the
  //               randomization is off (the server enforces both — see
  //               `hasTeamSplit` in server/team-count.ts).
  // The STORED values are deliberately left untouched: raising the count back to
  // 2 must restore whatever the operator had chosen, not a value we overwrote.
  // See specs/team-count.md.
  const showTeamCount = normalizeTeamCount(
    config.gameshows?.[config.activeGameshow]?.teamCount ?? DEFAULT_TEAM_COUNT,
  );
  const pointsLockedOff = showTeamCount === 0;
  const randomizationLockedOff = showTeamCount <= 1 || config.pointSystemEnabled === false;
  const lockNote = (why: string) => (
    <span className="be-hint" style={{ marginLeft: 8, fontStyle: 'italic' }}>{why}</span>
  );

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
          {/* Show title — the landing-page heading. A gameshow can override it in
              the Gameshows tab; blank here means the built-in default.
              See specs/show-title.md. */}
          <div style={{ alignSelf: 'stretch' }}>
            <label className="be-label" htmlFor="show-title">Titel der Show</label>
            <input
              id="show-title"
              className="be-input"
              value={config.showTitle ?? ''}
              placeholder={DEFAULT_SHOW_TITLE}
              onChange={e => setConfig({ ...config, showTitle: e.target.value })}
            />
            <p className="be-hint" style={{ marginTop: 4, marginBottom: 0 }}>
              Überschrift auf der Startseite (auch Gamemaster-Anzeige und Browser-Tab).
              Leer = „{DEFAULT_SHOW_TITLE}“. Einzelne Gameshows können den Titel im Tab
              „Gameshows“ überschreiben.
            </p>
          </div>
          <label className={`be-toggle${pointsLockedOff ? ' is-locked' : ''}`}>
            <input
              type="checkbox"
              checked={!pointsLockedOff && config.pointSystemEnabled !== false}
              disabled={pointsLockedOff}
              onChange={e => setConfig({ ...config, pointSystemEnabled: e.target.checked })}
            />
            <span className="be-toggle-track" />
            <span className="be-toggle-label">Punktesystem aktiviert</span>
            {pointsLockedOff && lockNote('— aus, weil die aktive Gameshow mit 0 Teams läuft')}
          </label>
          <label className={`be-toggle${randomizationLockedOff ? ' is-locked' : ''}`}>
            <input
              type="checkbox"
              checked={!randomizationLockedOff && config.teamRandomizationEnabled !== false}
              disabled={randomizationLockedOff}
              onChange={e => setConfig({ ...config, teamRandomizationEnabled: e.target.checked })}
            />
            <span className="be-toggle-track" />
            <span className="be-toggle-label">Team-Randomisierung aktiviert</span>
            {randomizationLockedOff && lockNote(
              showTeamCount <= 1
                ? `— aus, weil die aktive Gameshow mit ${showTeamCount} Team${showTeamCount === 1 ? '' : 's'} läuft`
                : '— aus, weil das Punktesystem deaktiviert ist',
            )}
          </label>
          <label
            className="be-toggle"
            title="Standardmäßig aus. Aktiviert die gespiegelte Team-Darstellung auf dem Gamemaster (der dem Publikum gegenübersteht) sowie den Button „Teams tauschen“, mit dem festgelegt wird, welches Team links steht."
          >
            <input
              type="checkbox"
              checked={config.teamMirrorEnabled === true}
              onChange={e => setConfig({ ...config, teamMirrorEnabled: e.target.checked })}
            />
            <span className="be-toggle-track" />
            <span className="be-toggle-label">Team-Spiegelung &amp; Seitenwechsel (Gamemaster)</span>
          </label>
          <label
            className="be-toggle"
            title="Standardmäßig aus. Markiert jedes Team überall, wo es vorkommt – Show, Gamemaster und Admin – mit seiner Farbe: ein farbiger Rand und ein Punkt neben dem Teamnamen. Die Schriftfarbe bleibt unverändert. Farben unten wählbar."
          >
            <input
              type="checkbox"
              checked={config.teamColorsEnabled === true}
              onChange={e => setConfig({ ...config, teamColorsEnabled: e.target.checked })}
            />
            <span className="be-toggle-track" />
            <span className="be-toggle-label">Team-Farben</span>
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

      {/* Team-Farben — the four colours the toggle above switches on. All four are
          editable whatever the active gameshow's team count is: picking them in
          advance is the point. A cleared field is stored as an empty string, which
          is the operator's explicit "use the theme's colour" — different from a key
          that was never touched (that one keeps the default). See specs/team-colors.md. */}
      <div className="backend-card">
        <h3>Team-Farben</h3>
        <p className="be-hint" style={{ marginTop: 0, marginBottom: 12 }}>
          Wird überall angezeigt, wo ein Team vorkommt — Show, Gamemaster und Admin:
          farbiger Rand plus ein Punkt neben dem Teamnamen. Leeres Feld = Farbe des aktiven
          Themes. Ohne die Option „Team-Farben“ oben werden keine Farben angezeigt.
        </p>
        <div className="config-team-colors">
          {ALL_TEAM_KEYS.map(key => {
            const n = teamNumber(key);
            const stored = config.teamColors?.[key];
            return (
              <div key={key}>
                <label className="be-label">Farbe Team {n}</label>
                <ColorPickerField
                  allowEmpty
                  aria-label={`Farbe Team ${n}`}
                  value={stored ?? DEFAULT_TEAM_COLORS[key]}
                  placeholder="#rrggbb"
                  removeTitle="Farbe entfernen (Farbe des Themes verwenden)"
                  onRemove={() => setConfig({ ...config, teamColors: { ...config.teamColors, [key]: '' } })}
                  onChange={value => {
                    setColorError(null);
                    setConfig({ ...config, teamColors: { ...config.teamColors, [key]: value } });
                  }}
                  onError={setColorError}
                />
                {n > showTeamCount && lockNote(
                  `— derzeit ohne Wirkung, die aktive Gameshow läuft mit ${showTeamCount} Team${showTeamCount === 1 ? '' : 's'}`,
                )}
              </div>
            );
          })}
        </div>
        {colorError && <p className="be-field-hint" role="alert">{colorError}</p>}
      </div>

      {/* Punkte-Regel-Texte — operator-editable wording for the globalRules scoring
          sentence, one per PointMode. GET /api/settings appends the entry matching
          the ACTIVE gameshow's pointMode; a blank field falls back to the built-in
          default (POINT_MODE_RULE_DEFAULTS). See specs/point-system.md. */}
      <div className="backend-card">
        <h3>Punkte-Regel-Texte</h3>
        <p style={{ fontSize: 'var(--admin-sz-12, 12px)', color: 'rgba(var(--text-rgb), max(0.5, var(--text-fade-floor, 0)))', marginTop: 0, marginBottom: 12 }}>
          Wird im Regelwerk automatisch an die globalen Regeln angehängt — je nachdem, welches
          Punktesystem die aktive Gameshow verwendet.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {ALL_POINT_MODES.map(mode => (
            <div key={mode}>
              <label className="be-label" htmlFor={`point-mode-rule-${mode}`}>{pointModeLabel(mode)}</label>
              <input
                id={`point-mode-rule-${mode}`}
                className="be-input"
                value={config.pointModeRules?.[mode] ?? POINT_MODE_RULE_DEFAULTS[mode]}
                onChange={e => setConfig({
                  ...config,
                  pointModeRules: { ...config.pointModeRules, [mode]: e.target.value },
                })}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Global rules */}
      <div className="backend-card">
        <h3>Globale Regeln</h3>
        <p style={{ fontSize: 'var(--admin-sz-12, 12px)', color: 'rgba(var(--text-rgb), max(0.5, var(--text-fade-floor, 0)))', marginTop: 0, marginBottom: 12 }}>
          Die Punkte-Regel (Text oben anpassbar, abhängig vom Punktesystem der aktiven Gameshow) wird
          automatisch ergänzt und muss hier nicht eingetragen werden.
        </p>
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
