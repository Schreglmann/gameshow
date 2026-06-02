import { useState, useEffect, useRef } from 'react';
import type { AppConfig, ContentChangedPayload } from '@/types/config';
import { fetchConfig, saveConfig } from '@/services/backendApi';
import { useWsChannel } from '@/services/useBackendSocket';
import { useTheme, THEMES } from '@/context/ThemeContext';
import RulesEditor from './RulesEditor';
import GameshowEditor from './GameshowEditor';
import StatusMessage from './StatusMessage';
import ConflictBanner from './ConflictBanner';
import { useConfirm } from './ConfirmContext';

function nameToId(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'gameshow';
}

function uniqueId(base: string, existing: string[], currentId: string): string {
  if (base === currentId || !existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

const THEME_GRADIENTS: Record<string, [string, string]> = {
  galaxia: ['#4a5bc4', '#5a3585'],
  'harry-potter': ['#1c0b2e', '#2a0e3a'],
  dnd: ['#111111', '#1a2416'],
  enterprise: ['#0f172a', '#1e293b'],
  retro: ['#000000', '#1a1a2e'],
  minecraft: ['#7cb9ff', '#5fb932'],
  'classical-music': ['#f4ecd8', '#7a1a2e'],
  'modern-music': ['#0a0a14', '#ff00aa'],
  'movie-quiz': ['#1a0a0d', '#f5c518'],
  deepsea: ['#021a26', '#2dd4bf'],
};

export default function ConfigTab() {
  const confirmDialog = useConfirm();
  const { theme, setTheme, adminTheme, setAdminTheme } = useTheme();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const isFirstRender = useRef(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasFetched = useRef(false);

  // ── Cross-tab live sync (admin multi-instance) — see specs/live-config-reload.md ──
  // Same reconciliation shape as GameEditor: `savedSnapshotRef` drives the dirty check,
  // `recentSelfWrites` suppresses our own echoes, `reconcileReq` guards stale re-fetches,
  // `skipNextSave` keeps an adopted remote config from bouncing straight back to the server.
  const savedSnapshotRef = useRef<string>('');
  const recentSelfWrites = useRef<Set<string>>(new Set());
  const reconcileReq = useRef(0);
  const skipNextSave = useRef(false);
  const [conflict, setConflict] = useState<{ fresh: AppConfig } | null>(null);

  const markSelfSaved = (payload: AppConfig) => {
    const s = JSON.stringify(payload);
    savedSnapshotRef.current = s;
    recentSelfWrites.current.add(s);
    setTimeout(() => recentSelfWrites.current.delete(s), 5000);
  };

  const adoptRemote = (fresh: AppConfig) => {
    // Mark BEFORE setConfig so the save effect early-returns and doesn't re-write it.
    skipNextSave.current = true;
    savedSnapshotRef.current = JSON.stringify(fresh);
    setConfig(fresh);
    setConflict(null);
  };

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    fetchConfig()
      .then(cfg => { setConfig(cfg); savedSnapshotRef.current = JSON.stringify(cfg); })
      .catch(e => setMessage({ type: 'error', text: `Fehler beim Laden: ${e.message}` }))
      .finally(() => setLoading(false));
  }, []);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  useEffect(() => {
    if (!config) return;
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await saveConfig(config);
        markSelfSaved(config);
        showMsg('success', '✅ Config gespeichert!');
      } catch (e) {
        showMsg('error', `❌ Fehler: ${(e as Error).message}`);
      }
    }, 800);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [config]);

  // React to a content-changed broadcast for config.json: adopt silently when clean,
  // show a banner when we have unsaved edits, ignore our own echoes.
  useWsChannel<ContentChangedPayload>('content-changed', (payload) => {
    if (!payload?.config || !config) return;
    const myReq = ++reconcileReq.current;
    fetchConfig()
      .then(fresh => {
        if (myReq !== reconcileReq.current || !config) return;
        const freshStr = JSON.stringify(fresh);
        if (recentSelfWrites.current.has(freshStr)) return;  // our own write echoing back
        if (freshStr === JSON.stringify(config)) return;      // already in sync
        const isDirty = JSON.stringify(config) !== savedSnapshotRef.current;
        if (isDirty) setConflict({ fresh });
        else adoptRemote(fresh);
      })
      .catch(() => { /* transient fetch error — keep current config */ });
  });

  const addGameshow = () => {
    if (!config) return;
    const base = nameToId('Neue Gameshow');
    const id = uniqueId(base, Object.keys(config.gameshows), '');
    setConfig({
      ...config,
      gameshows: {
        ...config.gameshows,
        [id]: { name: 'Neue Gameshow', gameOrder: [] },
      },
    });
  };

  const renameGameshow = (oldId: string, newName: string) => {
    if (!config) return;
    const newId = uniqueId(nameToId(newName), Object.keys(config.gameshows), oldId);
    if (newId === oldId) return;
    const { [oldId]: gs, ...rest } = config.gameshows;
    setConfig({
      ...config,
      activeGameshow: config.activeGameshow === oldId ? newId : config.activeGameshow,
      gameshows: { ...rest, [newId]: gs },
    });
  };

  const deleteGameshow = async (id: string) => {
    if (!config) return;
    if (!(await confirmDialog({ title: `Gameshow "${id}" wirklich löschen?` }))) return;
    const { [id]: _, ...rest } = config.gameshows;
    const newActive = config.activeGameshow === id ? Object.keys(rest)[0] ?? '' : config.activeGameshow;
    setConfig({ ...config, gameshows: rest, activeGameshow: newActive });
  };

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
          onDismiss={() => setConflict(null)}
        />
      )}

      {/* Themes */}
      <div className="backend-card" style={{ position: 'relative' }}>
        <a href="/show/theme-showcase" className="be-icon-btn" style={{ position: 'absolute', top: 12, right: 14, textDecoration: 'none' }}>Vorschau aller Komponenten →</a>
        <h3>Themes</h3>
        <div style={{ fontSize: 'var(--admin-sz-12, 12px)', color: 'rgba(var(--text-rgb), 0.5)', textAlign: 'center', marginTop: 18, marginBottom: 8 }}>Gameshow</div>
        <div className="theme-selector">
          {THEMES.map(t => {
            const [from, to] = THEME_GRADIENTS[t.id];
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
          {THEMES.map(t => {
            const [from, to] = THEME_GRADIENTS[t.id];
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

      {/* Gameshows */}
      <span className="section-title">Gameshows</span>
      {Object.entries(config.gameshows).map(([id, gs]) => (
        <GameshowEditor
          key={id}
          id={id}
          gameshow={gs}
          isActive={config.activeGameshow === id}
          onSetActive={() => setConfig({ ...config, activeGameshow: id })}
          onChange={updated =>
            setConfig({ ...config, gameshows: { ...config.gameshows, [id]: updated } })
          }
          onRename={newName => renameGameshow(id, newName)}
          onDelete={() => deleteGameshow(id)}
        />
      ))}
      <button className="be-icon-btn" onClick={addGameshow} style={{ marginBottom: 4 }}>
        + Neue Gameshow
      </button>

    </div>
  );
}
