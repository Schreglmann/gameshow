import { useMemo, useState } from 'react';
import type { AppConfig, Player } from '@/types/config';
import { adminLabel, fullName, hasFullName } from '@/utils/playerNames';
import { createPlayer } from '@/utils/playerRegistry';
import StatusMessage from './StatusMessage';
import ConflictBanner from './ConflictBanner';
import { useConfirm } from './ConfirmContext';
import { useEditableConfig } from './useEditableConfig';
import PlayerEditDialog, { type PlayerNames } from './PlayerEditDialog';
import { openPlayer } from './openPlayer';

/** Gameshow names a player is in, in config order. */
function gameshowsOf(config: AppConfig, id: string): string[] {
  return Object.values(config.gameshows)
    .filter(gs => (gs.players ?? []).includes(id))
    .map(gs => gs.name);
}

/**
 * The global player registry (`AppConfig.players`), as a read-only list of
 * whole names. A name opens the player lightbox (`PlayerLightbox`: names +
 * stats); new players are added in a popup (`PlayerEditDialog`).
 * Every player has a nickname (the show calls them by it; it defaults to the
 * first name) and usually a first name and a surname — a player added during
 * the show has only the nickname ("Name fehlt"). A full name exists only
 * once. Gameshows pick players from here by id, so a rename reaches every
 * gameshow. See specs/players.md.
 */
export default function PlayersTab() {
  const { config, setConfig, loading, message, showMsg, conflict, adoptRemote, dismissConflict } = useEditableConfig();
  const confirmDialog = useConfirm();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const registry = useMemo(() => config?.players ?? [], [config?.players]);
  const usage = useMemo(() => {
    const map = new Map<string, string[]>();
    if (config) for (const p of registry) map.set(p.id, gameshowsOf(config, p.id));
    return map;
  }, [config, registry]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return registry
      .filter(p => !q || `${fullName(p)} ${p.nickname}`.toLowerCase().includes(q))
      // A player added live has only a nickname: sorted by that.
      .sort((a, b) =>
        (a.firstName || a.nickname).localeCompare(b.firstName || b.nickname, 'de')
        || a.lastName.localeCompare(b.lastName, 'de'));
  }, [registry, search]);

  if (loading) return <div className="be-loading">Lade Spieler...</div>;
  if (!config) return <div className="be-loading">Config konnte nicht geladen werden.</div>;

  /** Create a player from the popup. Returns the error to show, or null. */
  const addPlayer = (names: PlayerNames): string | null => {
    const result = createPlayer(registry, names.firstName, names.lastName, names.nickname);
    if (!result.ok) return result.error;
    setConfig(prev => {
      if (!prev) return prev;
      const created = createPlayer(prev.players ?? [], names.firstName, names.lastName, names.nickname);
      return created.ok ? { ...prev, players: created.registry } : prev;
    });
    showMsg('success', `${adminLabel(result.player)} angelegt`);
    return null;
  };

  const deletePlayer = async (player: Player): Promise<boolean> => {
    const shows = usage.get(player.id) ?? [];
    const confirmed = await confirmDialog(
      shows.length > 0
        ? {
            title: `${adminLabel(player)} löschen?`,
            description: `In ${shows.length} Gameshow${shows.length === 1 ? '' : 's'} eingetragen (${shows.join(', ')}) – wird dort ebenfalls entfernt.`,
            confirmLabel: 'Löschen',
          }
        : { title: `${adminLabel(player)} löschen?`, confirmLabel: 'Löschen' },
    );
    if (!confirmed) return false;
    setConfig(prev => {
      if (!prev) return prev;
      const gameshows = Object.fromEntries(
        Object.entries(prev.gameshows).map(([key, gs]) => [
          key,
          gs.players?.includes(player.id) ? { ...gs, players: gs.players.filter(id => id !== player.id) } : gs,
        ]),
      );
      return { ...prev, players: (prev.players ?? []).filter(p => p.id !== player.id), gameshows };
    });
    return true;
  };

  return (
    <div>
      <div className="tab-toolbar" style={{ marginBottom: 14 }}>
        <h2 className="tab-title">Spieler</h2>
      </div>

      <StatusMessage message={message} />

      {conflict && (
        <ConflictBanner
          what="Die Konfiguration"
          onReload={() => adoptRemote(conflict.fresh)}
          onDismiss={dismissConflict}
        />
      )}

      <div className="backend-card">
        <div className="players-table-toolbar">
          <h3>{registry.length} Spieler</h3>
          <div className="players-table-actions">
            <input
              className="be-input players-table-search"
              // Opening the tab is usually to find someone.
              autoFocus
              type="search"
              placeholder="Suchen…"
              aria-label="Spieler suchen"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <button type="button" className="admin-button" onClick={() => setCreating(true)}>
              + Spieler
            </button>
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="players-table-empty">{registry.length === 0 ? 'Noch keine Spieler.' : 'Kein Spieler gefunden.'}</p>
        ) : (
          <ul className="players-list" aria-label="Spieler">
            {rows.map(player => {
              const shows = usage.get(player.id) ?? [];
              const named = hasFullName(player);
              const nick = named && player.nickname && player.nickname.toLowerCase() !== player.firstName.toLowerCase()
                ? player.nickname
                : null;
              return (
                <li className={`players-list-row${player.disabled ? ' is-disabled' : ''}`} key={player.id}>
                  <button
                    type="button"
                    className="players-list-name"
                    title="Spieler öffnen"
                    aria-label={`${adminLabel(player)} öffnen`}
                    onClick={() => openPlayer(player.id)}
                  >
                    {named ? (
                      <>
                        {player.firstName}
                        {nick && <span className="players-list-nick"> „{nick}“</span>}
                        {' '}{player.lastName}
                      </>
                    ) : (
                      <>
                        {player.nickname}
                        <span className="players-list-missing" title="Während der Show hinzugefügt – Vor- und Nachnamen ergänzen">Name fehlt</span>
                      </>
                    )}
                    {player.disabled && (
                      <span className="players-list-missing" title="Wird nicht mehr vorgeschlagen – nur, wenn ein Name vollständig eingetippt wird">Deaktiviert</span>
                    )}
                  </button>
                  <span
                    className="players-list-count"
                    title={shows.length > 0 ? shows.join(', ') : 'In keiner Gameshow'}
                    aria-label={`${shows.length} Gameshow${shows.length === 1 ? '' : 's'}`}
                  >
                    {shows.length}
                  </span>
                  <button
                    type="button"
                    className="be-icon-btn danger"
                    aria-label={`${adminLabel(player)} löschen`}
                    title="Löschen"
                    onClick={() => { void deletePlayer(player); }}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {creating && (
        <PlayerEditDialog
          title="Spieler hinzufügen"
          submitLabel="Hinzufügen"
          initial={{ firstName: '', lastName: '', nickname: '' }}
          onSubmit={addPlayer}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}
