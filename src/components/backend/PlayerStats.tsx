import { useState } from 'react';
import type { GameFileSummary, GameType, GameshowConfig } from '@/types/config';
import { computePlayerHistory, type PlayerHistoryEntry } from '@/utils/playerStats';
import { GAME_TYPE_INFO } from '@/data/gameTypeInfo';

interface Props {
  /** Registry id of the player; history is keyed by id. See specs/players.md. */
  playerId: string;
  /** Full name, for the empty-state text. */
  playerName: string;
  games: GameFileSummary[];
  gameshows: Record<string, GameshowConfig>;
  /** Config index of the active gameshow — groups at or after it are future
   *  ("eingeplant"), earlier ones are already played. */
  referenceIndex?: number;
  /** Focus a gameshow card in the Gameshows tab (expand + scroll). */
  onNavigateToGameshow: (gameshowId: string) => void;
  /** Called after a game link switched to the Spiele tab (the lightbox closes). */
  onNavigate?: () => void;
}

/**
 * A player's games-played history: the summary line, the per-type breakdown
 * (click a type to filter) and one collapsible group per gameshow. Part of the
 * player lightbox (`PlayerLightbox`). See specs/player-stats.md.
 */
export default function PlayerStats({ playerId, playerName, games, gameshows, referenceIndex, onNavigateToGameshow, onNavigate }: Props) {
  const [typeFilter, setTypeFilter] = useState<GameType | null>(null);
  // Gameshows the player already played start collapsed, upcoming ones open;
  // this holds the groups the operator flipped from that default.
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) =>
    setToggled(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const history = computePlayerHistory(playerId, games, gameshows, referenceIndex);
  const maxCount = history.byType.reduce((m, t) => Math.max(m, t.count), 0);

  // The type-filter narrows the displayed entries; the breakdown keeps its full
  // counts so the user can switch or clear the filter at any time.
  const groups = typeFilter
    ? history.groups
        .map(g => ({ ...g, entries: g.entries.filter(e => e.type === typeFilter) }))
        .filter(g => g.entries.length > 0)
    : history.groups;

  const openGame = (entry: PlayerHistoryEntry) => {
    // Hash-driven nav: AdminScreen's hashchange listener switches to the Spiele
    // tab and opens this game/instance. See AdminScreen.parseHash / syncFromHash.
    window.location.hash = entry.instance
      ? `games/${encodeURIComponent(entry.fileName)}/${encodeURIComponent(entry.instance)}`
      : `games/${encodeURIComponent(entry.fileName)}`;
    onNavigate?.();
  };

  const openGameshow = (gameshowId: string) => onNavigateToGameshow(gameshowId);

  return (
    <div className="player-stats">
      {history.groups.length === 0 ? (
        <p className="player-stats-empty">Noch keine Gameshow mit {playerName}.</p>
      ) : (
        <>
          <p className="player-stats-summary">
            {history.playedCount} gespielte{history.playedCount === 1 ? 's Spiel' : ' Spiele'}
            {' '}in {history.gameCount} verschiedenen Spiel{history.gameCount === 1 ? '' : 'en'}
            {` · ${history.gameshowCount} Gameshow${history.gameshowCount === 1 ? '' : 's'}`}
            {history.plannedCount > 0 && ` · ${history.plannedCount} eingeplant`}
          </p>

          <div className="player-stats-breakdown">
            {history.byType.map(t => (
              <button
                key={t.type}
                type="button"
                className={`player-stats-type-row${typeFilter === t.type ? ' is-active' : ''}`}
                aria-pressed={typeFilter === t.type}
                onClick={() => setTypeFilter(f => (f === t.type ? null : t.type))}
                title={typeFilter === t.type ? 'Filter aufheben' : `Nur ${t.label} zeigen`}
              >
                <span className="player-stats-type-label">{t.label}</span>
                <span className="player-stats-type-bar">
                  <span
                    className="player-stats-type-fill"
                    style={{ width: `${maxCount ? (t.count / maxCount) * 100 : 0}%` }}
                  />
                </span>
                <span className="player-stats-type-count">{t.count}</span>
              </button>
            ))}
          </div>

          {typeFilter && (
            <button type="button" className="player-stats-clear-filter" onClick={() => setTypeFilter(null)}>
              ✕ Filter „{GAME_TYPE_INFO[typeFilter]?.label ?? typeFilter}“ aufheben
            </button>
          )}

          <div className="player-stats-groups">
            {groups.map(group => {
              const key = group.gameshowId;
              const isCollapsed = group.planned ? toggled.has(key) : !toggled.has(key);
              return (
                <div className={`player-stats-group${group.planned ? ' is-planned' : ''}`} key={key}>
                  <div className="player-stats-group-header">
                    <button
                      type="button"
                      className="player-stats-group-toggle"
                      aria-expanded={!isCollapsed}
                      onClick={() => toggleGroup(key)}
                      title={isCollapsed ? 'Ausklappen' : 'Einklappen'}
                    >
                      <span className={`player-stats-group-chevron${isCollapsed ? '' : ' open'}`} aria-hidden="true">▶</span>
                    </button>
                    <button
                      type="button"
                      className="player-stats-group-title is-link"
                      onClick={() => openGameshow(group.gameshowId)}
                      title="Zur Gameshow"
                    >
                      {group.gameshowName}
                    </button>
                    {group.planned && <span className="overlap-badge overlap-planned">Eingeplant</span>}
                    <span className="player-stats-group-count">{group.entries.length}</span>
                  </div>
                  {!isCollapsed && (
                    <div className="player-stats-list">
                      {group.entries.map(e => (
                        <div key={e.ref} className="player-stats-entry">
                          <button
                            type="button"
                            className="player-stats-entry-main is-link"
                            onClick={() => openGame(e)}
                            title="Zum Spiel"
                          >
                            <span className="planning-title">{e.title}</span>
                            {e.instance && <span className="planning-instance">{e.instance}</span>}
                            <span className="player-stats-entry-type">{GAME_TYPE_INFO[e.type]?.label ?? e.type}</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
