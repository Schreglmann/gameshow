import { useState, useEffect, useRef } from 'react';
import type { AppConfig } from '@/types/config';
import { fetchConfig, saveConfig } from '@/services/backendApi';
import RulesEditor from './RulesEditor';
import GameshowEditor from './GameshowEditor';
import StatusMessage from './StatusMessage';

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

export default function ConfigTab() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const isFirstRender = useRef(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasFetched = useRef(false);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    fetchConfig()
      .then(setConfig)
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
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await saveConfig(config);
        showMsg('success', '✅ Config gespeichert!');
      } catch (e) {
        showMsg('error', `❌ Fehler: ${(e as Error).message}`);
      }
    }, 800);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [config]);

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

  const deleteGameshow = (id: string) => {
    if (!config) return;
    if (!confirm(`Gameshow "${id}" wirklich löschen?`)) return;
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

      {/* Global settings */}
      <div className="backend-card">
        <h3>Globale Einstellungen</h3>
        <label className="be-checkbox-row">
          <input
            type="checkbox"
            checked={config.pointSystemEnabled !== false}
            onChange={e => setConfig({ ...config, pointSystemEnabled: e.target.checked })}
          />
          Punktesystem aktiviert
        </label>
        <label className="be-checkbox-row">
          <input
            type="checkbox"
            checked={config.teamRandomizationEnabled !== false}
            onChange={e => setConfig({ ...config, teamRandomizationEnabled: e.target.checked })}
          />
          Team-Randomisierung aktiviert
        </label>
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
