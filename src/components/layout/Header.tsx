import { useGameContext } from '@/context/GameContext';
import TeamJokers from '@/components/common/TeamJokers';

interface HeaderProps {
  showGameNumber?: boolean;
}

export default function Header({ showGameNumber = true }: HeaderProps) {
  const { state } = useGameContext();
  const { pointSystemEnabled, enabledJokers } = state.settings;
  const { currentGame } = state;

  const hasJokers = (enabledJokers ?? []).length > 0;
  const showTeamColumns = pointSystemEnabled || hasJokers;
  const showGameCounter = showGameNumber && currentGame !== null;

  return (
    <header>
      {showTeamColumns ? (
        <div id="team1PointsContainer" className="team-header-cell team-header-team1">
          {pointSystemEnabled && (
            <span className="team-header-label">
              Team 1: <span>{state.teams.team1Points}</span> Punkte
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
              Team 2: <span>{state.teams.team2Points}</span> Punkte
            </span>
          )}
        </div>
      ) : (
        <div />
      )}
    </header>
  );
}
