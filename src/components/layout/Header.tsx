import { useGameContext } from '@/context/GameContext';

interface HeaderProps {
  showGameNumber?: boolean;
}

export default function Header({ showGameNumber = true }: HeaderProps) {
  const { state } = useGameContext();
  const { pointSystemEnabled } = state.settings;
  const { currentGame } = state;

  return (
    <header>
      {pointSystemEnabled && (
        <div id="team1PointsContainer">
          Team 1: <span>{state.teams.team1Points}</span> Punkte
        </div>
      )}
      {showGameNumber && currentGame && (
        <div id="gameNumber">
          Spiel {currentGame.currentIndex + 1} von {currentGame.totalGames}
        </div>
      )}
      {(!showGameNumber || !currentGame) && <div />}
      {pointSystemEnabled && (
        <div id="team2PointsContainer">
          Team 2: <span>{state.teams.team2Points}</span> Punkte
        </div>
      )}
    </header>
  );
}
