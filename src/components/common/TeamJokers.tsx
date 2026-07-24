import { useGameContext } from '@/context/GameContext';
import { useSendGamemasterCommand } from '@/hooks/useGamemasterSync';
import { getJoker } from '@/data/jokers';
import JokerIcon from '@/components/common/JokerIcon';
import type { JokerTeam } from '@/types/jokers';

interface TeamJokersProps {
  /** Which team's jokers to show (data + used state). */
  team: JokerTeam;
  /**
   * Which header cell this grid sits in — drives only the presentation class
   * (`header-jokers-left`/`-right`: separator side + tooltip direction), decoupled
   * from team identity so the team-order swap works. Defaults to the team's
   * natural side. See specs/team-order-mirror.md.
   */
  side?: 'left' | 'right';
}

/**
 * Compact row of joker icons for a single team, rendered inline inside the
 * Header (replaces the previous fixed JokerBar). Reads enabled list + used
 * state from context and emits `use-joker` gamemaster commands on click.
 */
export default function TeamJokers({ team, side }: TeamJokersProps) {
  const { state, dispatch } = useGameContext();
  const sendCommand = useSendGamemasterCommand();

  const enabled = state.settings.enabledJokers ?? [];
  const currentGame = state.currentGame;
  const isLastGame =
    currentGame !== null && currentGame.currentIndex === currentGame.totalGames - 1;
  // Jokers are hidden entirely in the last game unless the gameshow allows
  // them there (global `jokersInLastGame` flag); when allowed they behave
  // exactly like in any other game.
  const hideInLastGame = isLastGame && state.settings.jokersInLastGame !== true;
  if (enabled.length === 0 || hideInLastGame) return null;

  const used = team === 'team1' ? state.teams.team1JokersUsed : state.teams.team2JokersUsed;

  // The comeback joker (Aufholjoker) may only be spent by the strictly-trailing
  // team; on a tie neither team may use it. Computed at read time — never stored.
  const { team1Points, team2Points } = state.teams;
  const trailingTeam: JokerTeam | null =
    team1Points < team2Points ? 'team1' : team2Points < team1Points ? 'team2' : null;

  const handleClick = (jokerId: string, alreadyUsed: boolean) => {
    const nextUsed = !alreadyUsed;
    dispatch({ type: 'SET_JOKER_USED', payload: { team, jokerId, used: nextUsed } });
    sendCommand('use-joker', { team, jokerId, used: nextUsed ? 'true' : 'false' });
    // The comeback joker has a real scoring effect: arm/disarm the next-game
    // doubling for this team. See specs/comeback-joker.md.
    if (jokerId === 'comeback') {
      dispatch(nextUsed
        ? { type: 'ARM_DOUBLE_NEXT_GAME', payload: { team } }
        : { type: 'CLEAR_DOUBLE_NEXT_GAME' });
    }
  };

  // Grid: max 3 columns, max 2 rows. Count-adaptive so partial rows stay
  // balanced — 1→1×1, 2→2×1, 3→3×1, 4→2×2, 5→3×2 (one empty), 6→3×2 full.
  const count = enabled.length;
  const cols = count <= 3 ? count : Math.ceil(count / 2);
  const cellSide = side ?? (team === 'team1' ? 'left' : 'right');

  return (
    <div
      className={`header-jokers header-jokers-${cellSide}`}
      role="group"
      aria-label="Joker"
      style={{ '--joker-cols': cols } as React.CSSProperties}
    >
      {enabled.map(id => {
        const def = getJoker(id);
        if (!def) return null;
        const isUsed = used.includes(id);
        // Comeback joker is locked for the leading team / on a tie (unless
        // already used, so it can still be toggled off to disarm).
        const locked = id === 'comeback' && !isUsed && team !== trailingTeam;
        const tooltip = locked
          ? `${def.name} — nur das zurückliegende Team kann ihn einsetzen`
          : `${def.name} — ${def.description}`;
        return (
          <button
            key={id}
            type="button"
            className={`header-joker${isUsed ? ' header-joker-used' : ''}${locked ? ' header-joker-locked' : ''}`}
            aria-label={tooltip}
            aria-pressed={isUsed}
            disabled={locked}
            data-tooltip={tooltip}
            onClick={() => handleClick(id, isUsed)}
          >
            <span className="header-joker-svg" aria-hidden="true">
              <JokerIcon id={id} size={24} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
