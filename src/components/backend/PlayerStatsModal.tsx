import { useEffect, useState } from 'react';
import type { GameFileSummary, GameType, GameshowConfig } from '@/types/config';
import { computePlayerHistory, type PlayerHistoryEntry } from '@/utils/playerStats';
import { GAME_TYPE_INFO } from '@/data/gameTypeInfo';

interface Props {
  player: string;
  games: GameFileSummary[];
  gameshows: Record<string, GameshowConfig>;
  /** Focus a gameshow card in the Gameshows tab (expand + scroll). */
  onNavigateToGameshow: (gameshowId: string) => void;
  onClose: () => void;
}

/** Renders one `_players` session, highlighting the clicked player's token. */
function SessionTokens({ session, playerLower }: { session: string; playerLower: string }) {
  const parts = session.split(',').map(s => s.trim()).filter(Boolean);
  return (
    <span className="planning-session">
      {parts.map((p, i) => (
        <span key={i} className={p.toLowerCase() === playerLower ? 'session-player matched' : 'session-player'}>
          {p}{i < parts.length - 1 ? ', ' : ''}
        </span>
      ))}
    </span>
  );
}

export default function PlayerStatsModal({ player, games, gameshows, onNavigateToGameshow, onClose }: Props) {
  const [typeFilter, setTypeFilter] = useState<GameType | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const history = computePlayerHistory(player, games, gameshows);
  const playerLower = player.trim().toLowerCase();
  const maxCount = history.byType.reduce((m, t) => Math.max(m, t.count), 0);

  // The type-filter narrows the displayed groups/entries; the breakdown keeps its
  // full counts so the user can switch or clear the filter at any time.
  const groups = typeFilter
    ? history.groups
        .map(g => ({ ...g, entries: g.entries.filter(e => e.type === typeFilter) }))
        .filter(g => g.entries.length > 0)
    : history.groups;

  const openGame = (entry: PlayerHistoryEntry) => {
    // Hash-driven nav: AdminScreen's hashchange listener switches to the Spiele
    // tab and opens this game/instance. See AdminScreen.parseHash / syncFromHash.
    window.location.hash = `games/${encodeURIComponent(entry.fileName)}/${encodeURIComponent(entry.instance)}`;
    onClose();
  };

  const openGameshow = (gameshowId: string) => {
    onNavigateToGameshow(gameshowId);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="player-stats-box"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-stats-title"
      >
        <div className="player-stats-header">
          <h3 id="player-stats-title" className="player-stats-name">{player}</h3>
          <button className="be-icon-btn" onClick={onClose} aria-label="Schließen">✕</button>
        </div>

        {history.totalInstances === 0 ? (
          <p className="player-stats-empty">Noch keine gespielten Spiele für {player}.</p>
        ) : (
          <>
            <p className="player-stats-summary">
              {history.totalInstances} gespielte{history.totalInstances === 1 ? 's Spiel' : ' Spiele'}
              {' '}in {history.gameCount} verschiedenen Spiel{history.gameCount === 1 ? '' : 'en'}
              {history.gameshowCount > 0 && ` · ${history.gameshowCount} Gameshow${history.gameshowCount === 1 ? '' : 's'}`}
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
                const key = group.gameshowId ?? '__other__';
                const isCollapsed = collapsed.has(key);
                return (
                  <div className="player-stats-group" key={key}>
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
                      {group.gameshowId !== null ? (
                        <button
                          type="button"
                          className="player-stats-group-title is-link"
                          onClick={() => openGameshow(group.gameshowId!)}
                          title="Zur Gameshow"
                        >
                          {group.gameshowName}
                        </button>
                      ) : (
                        <span className="player-stats-group-title">Andere Spiele</span>
                      )}
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
                              <span className="planning-instance">{e.instance}</span>
                              <span className="player-stats-entry-type">{GAME_TYPE_INFO[e.type]?.label ?? e.type}</span>
                            </button>
                            <div className="planning-sessions">
                              {e.sessions.map((s, i) => (
                                <SessionTokens key={i} session={s} playerLower={playerLower} />
                              ))}
                            </div>
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
    </div>
  );
}
