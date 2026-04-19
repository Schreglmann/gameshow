import { useGameContext } from '@/context/GameContext';

interface CorrectAnswersTrackerProps {
  gameIndex: number;
}

export default function CorrectAnswersTracker({ gameIndex }: CorrectAnswersTrackerProps) {
  const { state, dispatch } = useGameContext();
  const entry = state.correctAnswersByGame[String(gameIndex)] ?? { team1: 0, team2: 0 };

  const update = (team: 'team1' | 'team2', delta: number) => {
    dispatch({ type: 'UPDATE_CORRECT_ANSWER', payload: { gameIndex, team, delta } });
  };

  const renderTeam = (team: 'team1' | 'team2', label: string, members: string[]) => (
    <div className="gm-correct-team">
      <div className="gm-correct-label">{label}</div>
      {members.length > 0 && (
        <div className="gm-correct-members">{members.join(', ')}</div>
      )}
      <div className="gm-correct-row">
        <button
          className="gm-btn gm-correct-btn"
          onClick={() => update(team, -1)}
          aria-label={`${label} minus`}
          disabled={entry[team] === 0}
        >
          −
        </button>
        <div className="gm-correct-count">{entry[team]}</div>
        <button
          className="gm-btn gm-correct-btn"
          onClick={() => update(team, 1)}
          aria-label={`${label} plus`}
        >
          +
        </button>
      </div>
    </div>
  );

  return (
    <div className="gm-correct-panel">
      {renderTeam('team1', 'Team 1', state.teams.team1)}
      {renderTeam('team2', 'Team 2', state.teams.team2)}
    </div>
  );
}
