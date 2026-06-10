import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { fetchGameData } from '@/services/api';
import { useGameContext } from '@/context/GameContext';
import { useTheme } from '@/context/ThemeContext';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';
import {
  useGamemasterControlsSync,
  useGamemasterCommandListener,
  useGamemasterSync,
} from '@/hooks/useGamemasterSync';
import { useWsChannel } from '@/services/useBackendSocket';
import type { ThemeId } from '@/context/ThemeContext';
import type { GameDataResponse, ContentChangedPayload } from '@/types/config';
import type { GamemasterAnswerData, GamemasterCommand, GamemasterControl } from '@/types/game';
import GameFactory from '@/components/games/GameFactory';

export default function GameScreen() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { state, awardPoints, dispatch } = useGameContext();
  const { setGameThemeOverride } = useTheme();
  const [gameData, setGameData] = useState<GameDataResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const gameIndex = parseInt(searchParams.get('index') || '0', 10);

  // Keep a ref of the latest currentGame so the loader can read its
  // totalGames without re-running every time state changes.
  const currentGameRef = useRef(state.currentGame);
  useEffect(() => { currentGameRef.current = state.currentGame; });

  // Monotonic request id: the navigation load and a live content-changed
  // refresh can both be in flight; only the newest result is applied, so a
  // slow earlier fetch can never clobber a newer one (replaces the per-effect
  // `cancelled` flag, which couldn't coordinate across two trigger sources).
  const reqIdRef = useRef(0);

  // Load the game data. `blank=true` (navigation) clears the screen to show
  // "Loading…" and start fresh; `blank=false` (live refresh) swaps the data in
  // place WITHOUT blanking, so the running game keeps its position/phase while
  // edited/added questions flow in. See specs/live-config-reload.md.
  //
  // On a live refresh the game at this index may have changed identity (the
  // current game was deleted in the config, so the next game shifted into this
  // slot) — that case is handled by keying <GameFactory> on `gameId` in the
  // render: a different gameId remounts the component, resetting it to the
  // title screen. If the deleted game was the LAST one, the index is now out of
  // range and the fetch 404s — jump to the summary screen.
  const loadGame = useCallback((blank: boolean) => {
    const myReq = ++reqIdRef.current;
    setError(null);
    if (blank) setGameData(null);

    // Reflect the navigation in the header immediately. totalGames is reused
    // from the previously known game — it's the same value on success, and
    // on failure the header still shows the attempted game number.
    const prevTotal = currentGameRef.current?.totalGames;
    if (prevTotal !== undefined) {
      dispatch({
        type: 'SET_CURRENT_GAME',
        payload: { currentIndex: gameIndex, totalGames: prevTotal },
      });
    }

    fetchGameData(gameIndex)
      .then(data => {
        if (myReq !== reqIdRef.current) return;
        setGameData(data);
        dispatch({
          type: 'SET_CURRENT_GAME',
          payload: {
            currentIndex: data.currentIndex,
            totalGames: data.totalGames,
          },
        });
      })
      .catch(err => {
        if (myReq !== reqIdRef.current) return;
        // Live refresh: a 404 means the game at this index no longer exists —
        // the current game was deleted and there's no next game → summary.
        // Transient (non-404) errors during a live refresh are ignored so a
        // network blip doesn't tear down a running game.
        if (!blank) {
          if ((err as { status?: number }).status === 404) navigate('/summary');
          return;
        }
        setError(err.message);
      });
  }, [gameIndex, dispatch, navigate]);

  // Navigation: blank + load whenever the game index changes.
  useEffect(() => { loadGame(true); }, [loadGame]);

  // Live refresh: re-fetch without blanking when config.json or a games/*.json
  // changes on disk, so typo fixes / appended questions / a reordered gameOrder
  // apply to the running game without a reload.
  useWsChannel<ContentChangedPayload>('content-changed', (payload) => {
    if (payload?.config || payload?.games) loadGame(false);
  });

  // Apply per-game theme override; clear on unmount or game change.
  // Skip animation on initial page load so the correct theme appears instantly.
  const hasHadGameData = useRef(false);
  useEffect(() => {
    const gameTheme = gameData?.config.theme as ThemeId | undefined;
    const immediate = !hasHadGameData.current;
    setGameThemeOverride(gameTheme ?? null, immediate);
    if (gameData) hasHadGameData.current = true;
    return () => setGameThemeOverride(null);
  }, [gameData, setGameThemeOverride]);

  const handleNextGame = useCallback(() => {
    if (!gameData) return;
    const nextIndex = gameData.currentIndex + 1;
    if (nextIndex >= gameData.totalGames) {
      navigate('/summary');
    } else {
      navigate(`/game?index=${nextIndex}`);
    }
  }, [gameData, navigate]);

  if (error) {
    return <GameLoadError gameIndex={gameIndex} />;
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
      key={gameData.gameId}
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

function GameLoadError({ gameIndex }: { gameIndex: number }) {
  const navigate = useNavigate();
  const { state } = useGameContext();
  const totalGames = state.currentGame?.totalGames;

  const handleNext = useCallback(() => {
    const nextIndex = gameIndex + 1;
    if (totalGames !== undefined && nextIndex >= totalGames) {
      navigate('/summary');
    } else {
      navigate(`/game?index=${nextIndex}`);
    }
  }, [gameIndex, totalGames, navigate]);

  const handleBack = useCallback(() => {
    if (gameIndex > 0) navigate(`/game?index=${gameIndex - 1}`);
  }, [gameIndex, navigate]);

  useKeyboardNavigation({ onNext: handleNext, onBack: handleBack, enabled: true });

  const syncData = useMemo<GamemasterAnswerData>(
    () => ({
      gameTitle: `Spiel ${gameIndex + 1} konnte nicht geladen werden`,
      questionNumber: 0,
      totalQuestions: 0,
      answer: '',
      screenLabel: 'Fehler beim Laden',
    }),
    [gameIndex],
  );
  useGamemasterSync(syncData);

  const controls = useMemo<GamemasterControl[]>(
    () => [{ type: 'nav', id: 'nav', hideBack: gameIndex === 0 }],
    [gameIndex],
  );
  useGamemasterControlsSync(controls, undefined, gameIndex, undefined, totalGames);

  useGamemasterCommandListener(
    useCallback(
      (cmd: GamemasterCommand) => {
        if (cmd.controlId === 'nav-forward' || cmd.controlId === 'nav-forward-long') {
          handleNext();
        } else if (cmd.controlId === 'nav-back') {
          handleBack();
        }
      },
      [handleNext, handleBack],
    ),
  );

  return (
    <div className="quiz-container">
      <h2>Spiel {gameIndex + 1} konnte nicht geladen werden</h2>
      <button className="quiz-button button-centered" style={{ marginTop: 'clamp(12px, 2.5vw, 20px)' }} onClick={handleNext}>
        Spiel überspringen →
      </button>
    </div>
  );
}
