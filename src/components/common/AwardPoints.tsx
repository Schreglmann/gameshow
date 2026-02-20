import { useState } from 'react';

interface AwardPointsProps {
  onAward: (team: 'team1' | 'team2') => void;
  onNext: () => void;
}

export default function AwardPoints({ onAward, onNext }: AwardPointsProps) {
  const [awarded, setAwarded] = useState(false);

  const handleAward = (team: 'team1' | 'team2') => {
    onAward(team);
    setAwarded(true);
  };

  return (
    <div id="awardPointsContainer">
      <h2>Punkte vergeben</h2>
      <button className="quiz-button" onClick={() => handleAward('team1')}>
        Team 1
      </button>
      <button className="quiz-button" onClick={() => handleAward('team2')}>
        Team 2
      </button>
      {awarded && (
        <button className="quiz-button next-game-button" onClick={onNext}>
          Nächstes Spiel
        </button>
      )}
    </div>
  );
}
