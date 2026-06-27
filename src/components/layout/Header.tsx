import { useEffect, useState } from 'react';
import { useGameContext } from '@/context/GameContext';
import TeamJokers from '@/components/common/TeamJokers';

interface HeaderProps {
  showGameNumber?: boolean;
}

export default function Header({ showGameNumber = true }: HeaderProps) {
  const { state } = useGameContext();
  const { pointSystemEnabled, enabledJokers, jokersInLastGame } = state.settings;
  const { currentGame } = state;

  const isLastGame =
    currentGame !== null && currentGame.currentIndex === currentGame.totalGames - 1;
  // Jokers are hidden in the last game unless explicitly allowed — don't let
  // them keep the team side-columns alive (empty glass cell) in that case.
  const hasJokers =
    (enabledJokers ?? []).length > 0 && !(isLastGame && jokersInLastGame !== true);
  const showTeamColumns = pointSystemEnabled || hasJokers;
  const showGameCounter = showGameNumber && currentGame !== null;

  const [isScrolled, setIsScrolled] = useState(false);
  useEffect(() => {
    const update = () => setIsScrolled(window.scrollY > 0);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  return (
    <header className={isScrolled ? 'is-scrolled' : undefined}>
      {showTeamColumns ? (
        <div id="team1PointsContainer" className="team-header-cell team-header-team1">
          {pointSystemEnabled && (
            <span className="team-header-label">
              Team 1: <span>{state.teams.team1Points}</span>{' '}
              {state.teams.team1Points === 1 ? 'Punkt' : 'Punkte'}
            </span>
          )}
          <TeamJokers team="team1" />
        </div>
      ) : (
        <div />
      )}

      {showGameCounter ? (
        <div id="gameNumber">
          Spiel {currentGame.currentIndex + 1} von {currentGame.totalGames}
        </div>
      ) : (
        <div />
      )}

      {showTeamColumns ? (
        <div id="team2PointsContainer" className="team-header-cell team-header-team2">
          <TeamJokers team="team2" />
          {pointSystemEnabled && (
            <span className="team-header-label">
              Team 2: <span>{state.teams.team2Points}</span>{' '}
              {state.teams.team2Points === 1 ? 'Punkt' : 'Punkte'}
            </span>
          )}
        </div>
      ) : (
        <div />
      )}
    </header>
  );
}
