import { useGameContext } from '@/context/GameContext';
import { teamName } from '@/utils/teamNames';
import { teamDisplayOrder } from '@/utils/teamOrder';

export interface AwardPointsWinners {
  team1: boolean;
  team2: boolean;
}

/**
 * A verdict the game computed itself (guessing-game's `scoringMode: 'auto'`). The
 * award screen then states who won instead of asking, and the host only confirms.
 * Wins are the reason for the award, never the point value.
 */
export interface AutoAwardVerdict {
  /** Questions won per team. A tied question counts for BOTH teams, so these need not
   *  add up to `scoredQuestions` — which is why the award screen states the points and
   *  the verdict, not an "x of y" fraction. Surfaced as the gamemaster's standing. */
  team1Wins: number;
  team2Wins: number;
  /** Questions that counted (the example question never does). Zero means "no verdict" —
   *  the wrapper then falls back to the manual winner selection. */
  scoredQuestions: number;
  /** Who receives points — both true on an overall tie. */
  winners: AwardPointsWinners;
}

/**
 * The verdict plus the points the wrapper will actually award — the positional
 * value, already doubled for an armed Aufholjoker — so what the screen states and
 * what gets booked cannot diverge.
 */
export interface AwardPointsAuto extends AutoAwardVerdict {
  points: { team1: number; team2: number };
}

interface AwardPointsProps {
  onComplete: (winners: AwardPointsWinners) => void;
  auto?: AwardPointsAuto | null;
}

export default function AwardPoints({ onComplete, auto }: AwardPointsProps) {
  const { state } = useGameContext();
  const armed = state.teams.doubleNextGame;
  // The armed team's positional points double for this award (Aufholjoker).
  const badge = (team: 'team1' | 'team2') =>
    armed === team ? <span className="award-double-badge" title="Aufholjoker: Punkte zählen doppelt">×2 Aufholjoker</span> : null;
  // Crowd-facing surface → follow the frontend team order (see specs/team-order-mirror.md).
  const order = teamDisplayOrder(state.teams.orderSwapped, false, state.settings.teamMirrorEnabled);

  if (auto) {
    const isDraw = auto.winners.team1 && auto.winners.team2;
    const winner = auto.winners.team1 ? 'team1' : 'team2';
    return (
      <div id="awardPointsContainer" className="quiz-container">
        <h2>Punkte vergeben</h2>
        <p className="award-points-hint">
          {isDraw
            ? 'Unentschieden — beide Teams erhalten Punkte'
            : `${teamName(state.teams, winner === 'team1' ? 1 : 2)} hat mehr Fragen gewonnen`}
        </p>
        <div className="award-auto-teams">
          {order.map(team => {
            const points = auto.points[team];
            const wins = team === 'team1' ? auto.team1Wins : auto.team2Wins;
            const isWinner = auto.winners[team];
            return (
              <div className={`award-auto-team${isWinner ? ' is-winner' : ''}`} key={team}>
                <span className="award-auto-team-name">
                  {teamName(state.teams, team === 'team1' ? 1 : 2)}
                  {badge(team)}
                </span>
                <span className="award-auto-points">
                  {points > 0 ? `+${points} ${points === 1 ? 'Punkt' : 'Punkte'}` : '0 Punkte'}
                </span>
                {/* A plain count, never "x von y": a drawn question counts for both teams,
                    so a fraction of the questions played would not add up. */}
                <span className="award-auto-wins">
                  {wins} {wins === 1 ? 'gewonnene Frage' : 'gewonnene Fragen'}
                </span>
              </div>
            );
          })}
        </div>
        <button
          className="quiz-button award-auto-confirm"
          onClick={() => onComplete(auto.winners)}
        >
          Punkte vergeben &amp; weiter
        </button>
      </div>
    );
  }

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
