import { useEffect, useMemo, useState } from 'react';
import type { GameFileSummary, Player } from '@/types/config';
import { fetchGames } from '@/services/backendApi';
import { adminLabel, normalizeWhitespace } from '@/utils/playerNames';
import { renamePlayer, setPlayerDisabled } from '@/utils/playerRegistry';
import { useEditableConfig } from './useEditableConfig';
import { useConfirm } from './ConfirmContext';
import { onOpenPlayer } from './openPlayer';
import PlayerStats from './PlayerStats';
import type { PlayerNames } from './PlayerEditDialog';

/** The form's values for a player: an empty nickname field means "same as the first name". */
function namesOf(player: Player): PlayerNames {
  return {
    firstName: player.firstName,
    lastName: player.lastName,
    nickname: player.nickname === player.firstName ? '' : player.nickname,
  };
}

/**
 * Whether the form already says what the player holds — the way a save would
 * store it (whitespace collapsed, empty nickname = first name). A trailing
 * space while typing "Anna Lena" is not a difference.
 */
function draftMatches(draft: PlayerNames, player: Player): boolean {
  const first = normalizeWhitespace(draft.firstName);
  return first === player.firstName
    && normalizeWhitespace(draft.lastName) === player.lastName
    && (normalizeWhitespace(draft.nickname) || first) === player.nickname;
}

/** Mounted once by AdminScreen: shows the lightbox for whichever player `openPlayer` names. */
export function PlayerLightboxHost() {
  const [playerId, setPlayerId] = useState<string | null>(null);
  useEffect(() => onOpenPlayer(setPlayerId), []);
  if (!playerId) return null;
  // Keyed, so opening another player starts from a fresh form.
  return <PlayerLightbox key={playerId} playerId={playerId} onClose={() => setPlayerId(null)} />;
}

interface Props {
  playerId: string;
  onClose: () => void;
}

/**
 * One lightbox per player, over whatever admin tab is open: the names
 * (editable, saved as you type like every admin field) and the games-played
 * statistics below them. Every clickable player name in the admin opens it
 * (`openPlayer`). It reads and saves the config itself, through the same save
 * queue as the tabs. See specs/players.md and specs/player-stats.md.
 */
export default function PlayerLightbox({ playerId, onClose }: Props) {
  const { config, setConfig, loading } = useEditableConfig();
  const confirmDialog = useConfirm();
  const [games, setGames] = useState<GameFileSummary[]>([]);
  const [draft, setDraft] = useState<PlayerNames | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  useEffect(() => {
    fetchGames().then(setGames).catch(() => { /* only resolves titles in the stats */ });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The delete confirmation handles its own Escape; don't close underneath it.
      if (e.key !== 'Escape' || document.querySelector('[role="alertdialog"]')) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const registry = useMemo(() => config?.players ?? [], [config?.players]);
  const player = registry.find(p => p.id === playerId);

  // The form follows the stored names: a rename from elsewhere replaces it.
  // Our own save coming back matches what is typed and leaves it alone, so
  // the caret and an unfinished trailing space survive.
  const namesKey = player ? `${player.firstName}|${player.lastName}|${player.nickname}` : '';
  const [seenKey, setSeenKey] = useState('');
  if (player && seenKey !== namesKey) {
    setSeenKey(namesKey);
    if (!draft || !draftMatches(draft, player)) {
      setDraft(namesOf(player));
      setError(null);
    }
  }

  // "Now" divider of the stats: shows before the active one are played.
  const referenceIndex = useMemo(() => {
    if (!config) return 0;
    const ids = Object.keys(config.gameshows);
    const i = ids.indexOf(config.activeGameshow);
    return i < 0 ? ids.length : i;
  }, [config]);

  // Every keystroke goes straight into the config (the save queue debounces
  // the write). A name the registry can't take shows why and is not saved
  // until it is fixed.
  const field = (key: keyof PlayerNames) => (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!player || !draft) return;
    const next = { ...draft, [key]: e.target.value };
    setDraft(next);
    if (draftMatches(next, player)) { setError(null); return; }
    const result = renamePlayer(registry, player.id, next.firstName, next.lastName, next.nickname);
    if (!result.ok) { setError(result.error); return; }
    setError(null);
    setConfig(prev => {
      if (!prev) return prev;
      const renamed = renamePlayer(prev.players ?? [], player.id, next.firstName, next.lastName, next.nickname);
      return renamed.ok ? { ...prev, players: renamed.registry } : prev;
    });
  };

  const remove = async () => {
    if (!player || !config) return;
    const shows = Object.values(config.gameshows).filter(gs => gs.players?.includes(player.id)).map(gs => gs.name);
    const confirmed = await confirmDialog(
      shows.length > 0
        ? {
            title: `${adminLabel(player)} löschen?`,
            description: `In ${shows.length} Gameshow${shows.length === 1 ? '' : 's'} eingetragen (${shows.join(', ')}) – wird dort ebenfalls entfernt.`,
            confirmLabel: 'Löschen',
          }
        : { title: `${adminLabel(player)} löschen?`, confirmLabel: 'Löschen' },
    );
    if (!confirmed) return;
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
    // Close on the next commit, not now: unmounting in the same tick would skip
    // useEditableConfig's save effect, and the deletion would never be written.
    setDeleted(true);
  };

  useEffect(() => {
    if (deleted) onClose();
  }, [deleted, onClose]);

  /** The "Aktiv" switch: a disabled player is no longer suggested (specs/players.md). */
  const setActive = (active: boolean) => {
    if (!player) return;
    setConfig(prev => prev && { ...prev, players: setPlayerDisabled(prev.players ?? [], player.id, !active) });
  };

  // A gameshow link in the stats: focus that card in the Gameshows tab.
  const openGameshow = (gsId: string) => {
    sessionStorage.setItem('focus-gameshow', gsId);
    window.location.hash = 'gameshows';
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="player-lightbox"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-lightbox-title"
      >
        {loading ? (
          <p className="player-stats-empty">Lade Spieler…</p>
        ) : !player || !draft ? (
          <>
            <div className="player-lightbox-header">
              <h2 id="player-lightbox-title" className="player-lightbox-name">Spieler</h2>
              <button type="button" className="be-icon-btn" onClick={onClose} aria-label="Schließen">✕</button>
            </div>
            <p className="player-stats-empty">Diesen Spieler gibt es nicht (mehr).</p>
          </>
        ) : (
          <>
            <div className="player-lightbox-header">
              <h2 id="player-lightbox-title" className="player-lightbox-name">{adminLabel(player)}</h2>
              <button type="button" className="be-icon-btn" onClick={onClose} aria-label="Schließen">✕</button>
            </div>
            {/* No autofill: the browser's contact autofill marks name fields, and there is nothing to fill. */}
            <form className="player-lightbox-names" onSubmit={e => e.preventDefault()} autoComplete="off">
              <label className="player-edit-field">
                <span className="be-label">Vorname</span>
                <input className="be-input" autoComplete="off" value={draft.firstName} onChange={field('firstName')} />
              </label>
              <label className="player-edit-field">
                <span className="be-label">Nachname</span>
                <input className="be-input" autoComplete="off" value={draft.lastName} onChange={field('lastName')} />
              </label>
              <label className="player-edit-field">
                <span className="be-label">Spitzname</span>
                <input
                  className="be-input"
                  autoComplete="off"
                  placeholder={normalizeWhitespace(draft.firstName) || 'Leer = Vorname'}
                  value={draft.nickname}
                  onChange={field('nickname')}
                />
              </label>
              <div className="player-lightbox-actions">
                <label className="be-toggle player-lightbox-active">
                  <input type="checkbox" checked={!player.disabled} onChange={e => setActive(e.target.checked)} />
                  <span className="be-toggle-track" />
                  <span className="be-toggle-label">Aktiv</span>
                </label>
                <button type="button" className="be-icon-btn danger" onClick={() => { void remove(); }}>Löschen</button>
              </div>
              {player.disabled && (
                <p className="be-field-hint player-lightbox-disabled-hint">
                  Deaktiviert: bleibt in seinen Gameshows, wird aber nicht mehr vorgeschlagen – nur, wenn ein Name vollständig eingetippt wird.
                </p>
              )}
            </form>
            {error && <p className="be-field-hint be-field-error" role="alert">{error}</p>}

            <h3 className="player-lightbox-section">Statistik</h3>
            <PlayerStats
              playerId={player.id}
              playerName={adminLabel(player)}
              games={games}
              gameshows={config!.gameshows}
              referenceIndex={referenceIndex}
              onNavigateToGameshow={openGameshow}
              onNavigate={onClose}
            />
          </>
        )}
      </div>
    </div>
  );
}
