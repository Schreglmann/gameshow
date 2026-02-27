import { useState } from 'react';

export interface AwardPointsWinners {
  team1: boolean;
  team2: boolean;
}

interface AwardPointsProps {
  onComplete: (winners: AwardPointsWinners) => void;
}

export default function AwardPoints({ onComplete }: AwardPointsProps) {
  const [team1, setTeam1] = useState(false);
  const [team2, setTeam2] = useState(false);

  const canContinue = team1 || team2;

  return (
    <div id="awardPointsContainer" className="quiz-container">
      <h2>Punkte vergeben</h2>
      <p className="award-points-hint">Welches Team hat gewonnen?</p>
      <div className="button-row award-points-teams">
        <button
          className={`quiz-button award-team-button${team1 ? ' active' : ''}`}
          onClick={() => setTeam1(p => !p)}
        >
          Team 1
        </button>
        <button
          className={`quiz-button award-team-button${team2 ? ' active' : ''}`}
          onClick={() => setTeam2(p => !p)}
        >
          Team 2
        </button>
      </div>
      <button
        className="quiz-button next-game-button button-centered"
        onClick={() => onComplete({ team1, team2 })}
        disabled={!canContinue}
      >
        Nächstes Spiel
      </button>
      {!canContinue && (
        <p className="award-points-warning">Bitte wähle mindestens ein Team aus</p>
      )}
    </div>
  );
}
