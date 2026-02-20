import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { fetchGameData } from '@/services/api';
import { useGameContext } from '@/context/GameContext';
import { useMusicPlayer } from '@/context/MusicContext';
import type { GameDataResponse, GameConfig } from '@/types/config';
import GameFactory from '@/components/games/GameFactory';

function gameHasAudio(config: GameConfig): boolean {
  // simple-quiz handles its own fade-in via onNextShow in BaseGameWrapper
  return config.type === 'audio-guess';
}

export default function GameScreen() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { awardPoints, dispatch } = useGameContext();
  const music = useMusicPlayer();
  const [gameData, setGameData] = useState<GameDataResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const gameIndex = parseInt(searchParams.get('index') || '0', 10);

  useEffect(() => {
    let cancelled = false;
    setGameData(null);
    setError(null);

    fetchGameData(gameIndex)
      .then(data => {
        if (!cancelled) {
          setGameData(data);
          dispatch({
            type: 'SET_CURRENT_GAME',
            payload: {
              currentIndex: data.currentIndex,
              totalGames: data.totalGames,
            },
          });
        }
      })
      .catch(err => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
      dispatch({ type: 'SET_CURRENT_GAME', payload: null });
    };
  }, [gameIndex, dispatch]);

  const handleNextGame = useCallback(() => {
    if (!gameData) return;
    // If we're leaving a game that uses audio, fade background music back in
    if (gameHasAudio(gameData.config)) {
      setTimeout(() => music.fadeIn(4000), 2000);
    }
    const nextIndex = gameData.currentIndex + 1;
    if (nextIndex >= gameData.totalGames) {
      navigate('/summary');
    } else {
      navigate(`/game?index=${nextIndex}`);
    }
  }, [gameData, navigate, music]);

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
      onAwardPoints={awardPoints}
    />
  );
}
