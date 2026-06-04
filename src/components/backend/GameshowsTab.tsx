import { useState, useEffect, useRef } from 'react';
import GameshowEditor from './GameshowEditor';
import StatusMessage from './StatusMessage';
import ConflictBanner from './ConflictBanner';
import { useConfirm } from './ConfirmContext';
import { useEditableConfig } from './useEditableConfig';

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

export default function GameshowsTab() {
  const confirmDialog = useConfirm();
  const { config, setConfig, loading, message, conflict, adoptRemote, dismissConflict } = useEditableConfig();

  // Which gameshow cards are expanded. Initialized ONCE on first config load to
  // contain only the active gameshow — see specs/admin-gameshows-tab.md. After
  // that, only explicit user actions (toggle, create) change it; activating a
  // different gameshow never auto-expands it.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const didInit = useRef(false);
  useEffect(() => {
    if (config && !didInit.current) {
      didInit.current = true;
      // Merge (not replace) so this one-shot init can't clobber an expansion a user
      // action already made if it happens to commit after that action (e.g. creating
      // a gameshow on the very first interaction). On a normal load the set is empty,
      // so this just expands the active gameshow.
      if (config.activeGameshow) {
        setExpandedIds(prev => new Set(prev).add(config.activeGameshow));
      }
    }
  }, [config]);

  const toggleExpanded = (id: string) =>
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
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
    // A freshly created gameshow opens expanded for immediate editing.
    setExpandedIds(prev => new Set(prev).add(id));
  };

  const renameGameshow = (oldId: string, newName: string) => {
    if (!config) return;
    const gs = config.gameshows[oldId];
    if (!gs) return;
    const trimmed = newName.trim();
    // Empty input or no change → cancel without touching the config.
    if (!trimmed || trimmed === gs.name) return;
    const renamed = { ...gs, name: trimmed };
    const newId = uniqueId(nameToId(trimmed), Object.keys(config.gameshows), oldId);
    // Pure display-name change (id derives to the same slug): keep the id, update the name.
    if (newId === oldId) {
      setConfig({ ...config, gameshows: { ...config.gameshows, [oldId]: renamed } });
      return;
    }
    // Rebuild the map preserving insertion order, swapping the key in place — so the
    // renamed gameshow keeps its position in the list instead of jumping to the end.
    const gameshows = Object.fromEntries(
      Object.entries(config.gameshows).map(([key, value]) =>
        key === oldId ? [newId, renamed] : [key, value]
      )
    );
    setConfig({
      ...config,
      activeGameshow: config.activeGameshow === oldId ? newId : config.activeGameshow,
      gameshows,
    });
    // Carry the expansion state across the id change so a renamed card stays open.
    setExpandedIds(prev => {
      if (!prev.has(oldId)) return prev;
      const next = new Set(prev);
      next.delete(oldId);
      next.add(newId);
      return next;
    });
  };

  const deleteGameshow = async (id: string) => {
    if (!config) return;
    if (!(await confirmDialog({ title: `Gameshow "${id}" wirklich löschen?` }))) return;
    const { [id]: _, ...rest } = config.gameshows;
    const newActive = config.activeGameshow === id ? Object.keys(rest)[0] ?? '' : config.activeGameshow;
    setConfig({ ...config, gameshows: rest, activeGameshow: newActive });
    setExpandedIds(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  if (loading) return <div className="be-loading">Lade Gameshows...</div>;
  if (!config) return <div className="be-loading">Config konnte nicht geladen werden.</div>;

  return (
    <div>
      <div className="tab-toolbar" style={{ marginBottom: 14 }}>
        <h2 className="tab-title">Gameshows</h2>
      </div>

      <StatusMessage message={message} />

      {conflict && (
        <ConflictBanner
          what="Die Konfiguration"
          onReload={() => adoptRemote(conflict.fresh)}
          onDismiss={dismissConflict}
        />
      )}

      {Object.entries(config.gameshows).map(([id, gs]) => (
        <GameshowEditor
          key={id}
          id={id}
          gameshow={gs}
          isActive={config.activeGameshow === id}
          expanded={expandedIds.has(id)}
          onToggleExpand={() => toggleExpanded(id)}
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
