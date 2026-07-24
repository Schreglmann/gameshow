import { useGameContext } from '@/context/GameContext';
import { teamName } from '@/utils/teamNames';
import { teamDisplayOrder } from '@/utils/teamOrder';

export interface AwardPointsWinners {
  team1: boolean;
  team2: boolean;
}

interface AwardPointsProps {
  onComplete: (winners: AwardPointsWinners) => void;
}

export default function AwardPoints({ onComplete }: AwardPointsProps) {
  const { state } = useGameContext();
  const armed = state.teams.doubleNextGame;
  // The armed team's positional points double for this award (Aufholjoker).
  const badge = (team: 'team1' | 'team2') =>
    armed === team ? <span className="award-double-badge" title="Aufholjoker: Punkte zählen doppelt">×2 Aufholjoker</span> : null;
  // Crowd-facing surface → follow the frontend team order (see specs/team-order-mirror.md).
  const order = teamDisplayOrder(state.teams.orderSwapped, false, state.settings.teamMirrorEnabled);
  return (
    <div id="awardPointsContainer" className="quiz-container">
      <h2>Punkte vergeben</h2>
      <p className="award-points-hint">Welches Team hat gewonnen?</p>
      <div className="button-row award-points-teams">
        {order.map(team => (
          <button
            key={team}
            className="quiz-button award-team-button"
            onClick={() => onComplete({ team1: team === 'team1', team2: team === 'team2' })}
          >
            {teamName(state.teams, team === 'team1' ? 1 : 2)}
            {badge(team)}
          </button>
        ))}
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
