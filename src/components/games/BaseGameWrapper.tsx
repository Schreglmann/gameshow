import { useState, useCallback, useMemo, type ReactNode } from 'react';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';
import { useGamemasterSync, useGamemasterControlsSync, useGamemasterCommandListener } from '@/hooks/useGamemasterSync';
import AwardPoints, { type AwardPointsWinners } from '@/components/common/AwardPoints';
import { useGameContext } from '@/context/GameContext';
import type { GamemasterAnswerData, GamemasterControl, GamemasterCommand } from '@/types/game';

type Phase = 'landing' | 'rules' | 'game' | 'points';

interface BaseGameWrapperProps {
  title: string;
  rules: string[];
  totalQuestions?: number;
  pointSystemEnabled: boolean;
  /** Game index (0-based); when 0, hides 'back' nav on landing/rules phases */
  currentIndex?: number;
  /** Points awarded to the winning team (should be currentIndex + 1) */
  pointValue?: number;
  /** If the game type always uses points (e.g. quizjagd, final-quiz) */
  requiresPoints?: boolean;
  /** Skip the award-points screen after game completion (e.g. final-quiz awards points inline) */
  skipPointsScreen?: boolean;
  /** Called when the rules screen is shown (landing → rules transition) */
  onRulesShow?: () => void;
  /** Called when the award-points phase is shown (or at game completion if points are skipped) */
  onNextShow?: () => void;
  onAwardPoints: (team: 'team1' | 'team2', points: number) => void;
  onNextGame: () => void;
  /** The main game content rendered in 'game' phase */
  children: (props: {
    onGameComplete: () => void;
    /** Navigate within game on click/keypress */
    handleNav: () => void;
    handleBackNav: () => void;
    setNavHandler: (fn: (() => void) | null) => void;
    setBackNavHandler: (fn: (() => boolean) | null) => void;
    setGamemasterData: (data: GamemasterAnswerData | null) => void;
    setGamemasterControls: (controls: GamemasterControl[]) => void;
    setCommandHandler: (fn: ((cmd: GamemasterCommand) => void) | null) => void;
  }) => ReactNode;
}

export default function BaseGameWrapper({
  title,
  rules,
  totalQuestions,
  pointSystemEnabled,
  currentIndex,
  pointValue = 1,
  requiresPoints,
  skipPointsScreen,
  onRulesShow,
  onNextShow,
  onAwardPoints,
  onNextGame,
  children,
}: BaseGameWrapperProps) {
  const [phase, setPhase] = useState<Phase>('landing');
  const [navHandler, setNavHandlerState] = useState<(() => void) | null>(null);
  const [backNavHandler, setBackNavHandlerState] = useState<(() => boolean) | null>(null);
  const [gamemasterData, setGamemasterData] = useState<GamemasterAnswerData | null>(null);
  const [gameControls, setGameControls] = useState<GamemasterControl[]>([]);
  const [commandHandler, setCommandHandlerState] = useState<((cmd: GamemasterCommand) => void) | null>(null);

  const { dispatch: gameDispatch } = useGameContext();

  const phaseLabels: Record<Phase, string> = {
    landing: 'Titel',
    rules: 'Regeln',
    game: '',
    points: 'Punktevergabe',
  };

  const syncData = useMemo((): GamemasterAnswerData | null => {
    if (phase === 'game') return gamemasterData;
    return {
      gameTitle: title,
      questionNumber: 0,
      totalQuestions: totalQuestions ?? 0,
      answer: '',
      screenLabel: phaseLabels[phase],
    };
  }, [phase, gamemasterData, title, totalQuestions]);

  useGamemasterSync(syncData);

  const shouldShowPoints = !skipPointsScreen && (pointSystemEnabled || requiresPoints);

  const handleNav = useCallback(() => {
    if (phase === 'landing') {
      if (rules.length > 0) {
        setPhase('rules');
        onRulesShow?.();
      } else {
        setPhase('game');
      }
    } else if (phase === 'rules') {
      setPhase('game');
    } else if (phase === 'game') {
      navHandler?.();
    }
  }, [phase, navHandler]);

  const handleBackNav = useCallback(() => {
    if (phase === 'game') {
      const handled = backNavHandler?.() ?? false;
      if (!handled) {
        if (rules.length > 0) {
          setPhase('rules');
        } else {
          setPhase('landing');
        }
      }
    } else if (phase === 'rules') {
      setPhase('landing');
    }
  }, [phase, backNavHandler, rules.length]);

  useKeyboardNavigation({
    onNext: handleNav,
    onBack: handleBackNav,
    enabled: phase !== 'points',
  });

  const onGameComplete = useCallback(() => {
    if (shouldShowPoints) {
      setPhase('points');
      onNextShow?.();
    } else {
      onNextShow?.();
      onNextGame();
    }
  }, [shouldShowPoints, onNextShow, onNextGame]);

  const handleComplete = useCallback(
    (winners: AwardPointsWinners) => {
      if (winners.team1) onAwardPoints('team1', pointValue);
      if (winners.team2) onAwardPoints('team2', pointValue);
      onNextGame();
    },
    [onAwardPoints, pointValue, onNextGame]
  );

  // Build controls based on current phase
  const allControls = useMemo((): GamemasterControl[] => {
    if (phase === 'landing' || phase === 'rules') {
      return [{ type: 'nav', id: 'nav', hideBack: currentIndex === 0 } as GamemasterControl];
    }
    if (phase === 'game') {
      return [{ type: 'nav', id: 'nav' }, ...gameControls];
    }
    if (phase === 'points') {
      return [{
        type: 'button-group',
        id: 'award',
        label: 'Punkte vergeben',
        buttons: [
          { id: 'award-team1', label: 'Team 1', variant: 'primary' },
          { id: 'award-team2', label: 'Team 2', variant: 'primary' },
          { id: 'award-draw', label: 'Unentschieden', variant: 'primary' },
        ],
      }];
    }
    return [];
  }, [phase, gameControls]);

  useGamemasterControlsSync(allControls, phase, currentIndex);

  // Route incoming commands from the gamemaster
  useGamemasterCommandListener(useCallback((cmd: GamemasterCommand) => {
    if (cmd.controlId === 'nav-forward') {
      handleNav();
    } else if (cmd.controlId === 'nav-forward-long') {
      // Long-press ArrowRight: forward to game (Bandle uses this to reveal answer),
      // fall back to normal nav if the game doesn't handle it
      if (commandHandler) {
        commandHandler(cmd);
      } else {
        handleNav();
      }
    } else if (cmd.controlId === 'nav-back') {
      handleBackNav();
    } else if (cmd.controlId === 'award-team1') {
      handleComplete({ team1: true, team2: false });
    } else if (cmd.controlId === 'award-team2') {
      handleComplete({ team1: false, team2: true });
    } else if (cmd.controlId === 'award-draw') {
      handleComplete({ team1: true, team2: true });
    } else if (cmd.controlId === 'use-joker' && cmd.value && typeof cmd.value === 'object') {
      const { team, jokerId, used } = cmd.value as { team?: string; jokerId?: string; used?: string };
      if ((team === 'team1' || team === 'team2') && typeof jokerId === 'string') {
        gameDispatch({
          type: 'SET_JOKER_USED',
          payload: { team, jokerId, used: used !== 'false' },
        });
      }
    } else {
      commandHandler?.(cmd);
    }
  }, [handleNav, handleBackNav, handleComplete, commandHandler, gameDispatch]));

  return (
    <>
      {phase === 'landing' && (
        <div id="landingScreen" className="quiz-container">
          <h2>{title}</h2>
        </div>
      )}

      {phase === 'rules' && (
        <div id="rulesScreen" className="quiz-container">
          <h3>Regeln:</h3>
          <ul id="rulesList">
            {rules.map((rule, i) => (
              <li key={i}>{rule}</li>
            ))}
            {totalQuestions !== undefined && totalQuestions > 0 && (
              <li>Es gibt insgesamt {totalQuestions} Fragen.</li>
            )}
          </ul>
        </div>
      )}

      {phase === 'game' && (
        <div id="gameScreen" className="quiz-container">
          {children({
            onGameComplete,
            handleNav,
            handleBackNav,
            setNavHandler: fn => setNavHandlerState(() => fn),
            setBackNavHandler: fn => setBackNavHandlerState(() => fn),
            setGamemasterData,
            setGamemasterControls: setGameControls,
            setCommandHandler: fn => setCommandHandlerState(() => fn),
          })}
        </div>
      )}

      {phase === 'points' && (
        <AwardPoints onComplete={handleComplete} />
      )}
    </>
  );
}
