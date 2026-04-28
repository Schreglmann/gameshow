import { useGameContext } from '@/context/GameContext';
import { useSendGamemasterCommand } from '@/hooks/useGamemasterSync';
import { getJoker } from '@/data/jokers';
import JokerIcon from '@/components/common/JokerIcon';
import type { JokerTeam } from '@/types/jokers';

interface TeamJokersProps {
  team: JokerTeam;
}

/**
 * Compact row of joker icons for a single team, rendered inline inside the
 * Header (replaces the previous fixed JokerBar). Reads enabled list + used
 * state from context and emits `use-joker` gamemaster commands on click.
 */
export default function TeamJokers({ team }: TeamJokersProps) {
  const { state, dispatch } = useGameContext();
  const sendCommand = useSendGamemasterCommand();

  const enabled = state.settings.enabledJokers ?? [];
  if (enabled.length === 0) return null;

  const used = team === 'team1' ? state.teams.team1JokersUsed : state.teams.team2JokersUsed;
  const currentGame = state.currentGame;
  const isLastGame =
    currentGame !== null && currentGame.currentIndex === currentGame.totalGames - 1;

  const handleClick = (jokerId: string, alreadyUsed: boolean) => {
    if (isLastGame && !alreadyUsed) return;
    const nextUsed = !alreadyUsed;
    dispatch({ type: 'SET_JOKER_USED', payload: { team, jokerId, used: nextUsed } });
    sendCommand('use-joker', { team, jokerId, used: nextUsed ? 'true' : 'false' });
  };

  // Grid: max 3 columns, max 2 rows. Count-adaptive so partial rows stay
  // balanced — 1→1×1, 2→2×1, 3→3×1, 4→2×2, 5→3×2 (one empty), 6→3×2 full.
  const count = enabled.length;
  const cols = count <= 3 ? count : Math.ceil(count / 2);

  return (
    <div
      className={`header-jokers header-jokers-${team}`}
      role="group"
      aria-label="Joker"
      style={{ '--joker-cols': cols } as React.CSSProperties}
    >
      {enabled.map(id => {
        const def = getJoker(id);
        if (!def) return null;
        const isUsed = used.includes(id);
        const locked = isLastGame && !isUsed;
        const tooltip = locked
          ? `${def.name} — ${def.description} (im letzten Spiel gesperrt)`
          : `${def.name} — ${def.description}`;
        return (
          <button
            key={id}
            type="button"
            className={`header-joker${isUsed ? ' header-joker-used' : ''}${locked ? ' header-joker-locked' : ''}`}
            aria-label={tooltip}
            aria-pressed={isUsed}
            aria-disabled={locked}
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
