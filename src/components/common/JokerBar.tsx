import { useGameContext } from '@/context/GameContext';
import { useSendGamemasterCommand } from '@/hooks/useGamemasterSync';
import { getJoker } from '@/data/jokers';
import type { JokerTeam } from '@/types/jokers';
import '@/styles/joker-bar.css';

interface JokerBarProps {
  isLastGame: boolean;
}

export default function JokerBar({ isLastGame }: JokerBarProps) {
  const { state, dispatch } = useGameContext();
  const sendCommand = useSendGamemasterCommand();
  const enabled = state.settings.enabledJokers ?? [];

  if (enabled.length === 0) return null;

  const handleClick = (team: JokerTeam, jokerId: string, alreadyUsed: boolean) => {
    if (alreadyUsed || isLastGame) return;
    dispatch({ type: 'USE_JOKER', payload: { team, jokerId } });
    sendCommand('use-joker', { team, jokerId, used: 'true' });
  };

  return (
    <div className="joker-bar" role="region" aria-label="Joker">
      <TeamColumn
        team="team1"
        label="Team 1"
        enabled={enabled}
        used={state.teams.team1JokersUsed}
        isLastGame={isLastGame}
        onJokerClick={handleClick}
      />
      <TeamColumn
        team="team2"
        label="Team 2"
        enabled={enabled}
        used={state.teams.team2JokersUsed}
        isLastGame={isLastGame}
        onJokerClick={handleClick}
      />
    </div>
  );
}

interface TeamColumnProps {
  team: JokerTeam;
  label: string;
  enabled: string[];
  used: string[];
  isLastGame: boolean;
  onJokerClick: (team: JokerTeam, jokerId: string, alreadyUsed: boolean) => void;
}

function TeamColumn({ team, label, enabled, used, isLastGame, onJokerClick }: TeamColumnProps) {
  return (
    <div className={`joker-bar-team joker-bar-${team}`}>
      <span className="joker-bar-label">{label}</span>
      <div className="joker-bar-icons">
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
              className={`joker-icon${isUsed ? ' joker-icon-used' : ''}${locked ? ' joker-icon-locked' : ''}`}
              aria-label={tooltip}
              aria-disabled={isUsed || locked}
              data-tooltip={tooltip}
              onClick={() => onJokerClick(team, id, isUsed)}
            >
              <span className="joker-icon-emoji" aria-hidden="true">
                {def.icon}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
