import { useGameContext } from '@/context/GameContext';
import { teamName } from '@/utils/teamNames';

export interface AwardPointsWinners {
  team1: boolean;
  team2: boolean;
}

interface AwardPointsProps {
  onComplete: (winners: AwardPointsWinners) => void;
}

export default function AwardPoints({ onComplete }: AwardPointsProps) {
  const { state } = useGameContext();
  return (
    <div id="awardPointsContainer" className="quiz-container">
      <h2>Punkte vergeben</h2>
      <p className="award-points-hint">Welches Team hat gewonnen?</p>
      <div className="button-row award-points-teams">
        <button
          className="quiz-button award-team-button"
          onClick={() => onComplete({ team1: true, team2: false })}
        >
          {teamName(state.teams, 1)}
        </button>
        <button
          className="quiz-button award-team-button"
          onClick={() => onComplete({ team1: false, team2: true })}
        >
          {teamName(state.teams, 2)}
        </button>
        <button
          className="quiz-button award-team-button"
          onClick={() => onComplete({ team1: true, team2: true })}
        >
          Unentschieden
        </button>
      </div>
    </div>
  );
}
