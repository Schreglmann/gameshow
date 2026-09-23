import { useGameContext } from '@/context/GameContext';
import { GAME_TYPE_INFO } from '@/data/gameTypeInfo';
import type { GameType } from '@/types/config';

/**
 * Pre-flight warning on the HomeScreen: names the games in this gameshow whose
 * mechanic cannot be scored at the configured team count. Those games still play
 * — the server simply serves them `pointSystemEnabled: false` — so this is
 * purely informational and never blocks the start.
 *
 * The list comes from `GlobalSettings.incompatibleGames`, computed server-side
 * from the active `gameOrder` (the show has no other view of the gameshow's
 * games). See specs/team-count.md.
 *
 * Click and keydown are stopped: HomeScreen has a window-level listener that
 * advances to /rules on ANY click or arrow/space keypress, and reading a warning
 * must not start the show.
 */
export default function TeamCountWarning() {
  const { state } = useGameContext();
  const { incompatibleGames, teamCount } = state.settings;

  if (incompatibleGames.length === 0) return null;

  const label = (type: string) =>
    GAME_TYPE_INFO[type as GameType]?.label ?? type;

  const n = incompatibleGames.length;
  return (
    <div
      className="cache-preflight-banner team-count-warning"
      role="status"
      onClick={e => e.stopPropagation()}
      onKeyDown={e => e.stopPropagation()}
    >
      <div className="cache-preflight-banner__head">
        <span className="cache-preflight-banner__icon" aria-hidden="true">⚠️</span>
        <strong>
          {n === 1 ? '1 Spiel passt' : `${n} Spiele passen`} nicht zu {teamCount}{' '}
          {teamCount === 1 ? 'Team' : 'Teams'} und {n === 1 ? 'wird' : 'werden'} ohne Wertung gespielt
        </strong>
      </div>
      <ul className="cache-preflight-banner__list">
        {incompatibleGames.map(game => (
          <li key={game.index}>
            {game.title} <span className="team-count-warning__type">({label(game.type)})</span>
            {' · '}Runde {game.index + 1}
          </li>
        ))}
      </ul>
    </div>
  );
}
