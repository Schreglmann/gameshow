import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { fetchGameData } from '@/services/api';
import { useGameContext } from '@/context/GameContext';
import type { GameDataResponse } from '@/types/config';
import GameFactory from '@/components/games/GameFactory';

export default function GameScreen() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { awardPoints } = useGameContext();
  const [gameData, setGameData] = useState<GameDataResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const gameIndex = parseInt(searchParams.get('index') || '0', 10);

  useEffect(() => {
    let cancelled = false;
    setGameData(null);
    setError(null);

    fetchGameData(gameIndex)
      .then(data => {
        if (!cancelled) setGameData(data);
      })
      .catch(err => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [gameIndex]);

  const handleNextGame = useCallback(() => {
    if (!gameData) return;
    const nextIndex = gameData.currentIndex + 1;
    if (nextIndex >= gameData.totalGames) {
      navigate('/summary');
    } else {
      navigate(`/game?index=${nextIndex}`);
    }
  }, [gameData, navigate]);

  const handleAwardPoints = useCallback(
    (team: 'team1' | 'team2', points: number) => {
      awardPoints(team, points);
    },
    [awardPoints]
  );

  if (error) {
    return (
      <div className="quiz-container">
        <h2>Error loading game</h2>
        <p>{error}</p>
      </div>
    );
  }

  if (!gameData) {
    return (
      <div className="quiz-container">
        <h2>Loading...</h2>
      </div>
    );
  }

  return (
    <GameFactory
      config={gameData.config}
      gameId={gameData.gameId}
      currentIndex={gameData.currentIndex}
      totalGames={gameData.totalGames}
      pointSystemEnabled={gameData.pointSystemEnabled}
      onNextGame={handleNextGame}
      onAwardPoints={handleAwardPoints}
    />
  );
}
