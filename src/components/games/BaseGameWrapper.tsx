import { useState, useCallback, type ReactNode } from 'react';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';
import AwardPoints, { type AwardPointsWinners } from '@/components/common/AwardPoints';

type Phase = 'landing' | 'rules' | 'game' | 'points' | 'next';

interface BaseGameWrapperProps {
  title: string;
  rules: string[];
  totalQuestions?: number;
  pointSystemEnabled: boolean;
  /** Points awarded to the winning team (should be currentIndex + 1) */
  pointValue?: number;
  /** If the game type always uses points (e.g. quizjagd, final-quiz) */
  requiresPoints?: boolean;
  /** Skip the award-points screen after game completion (e.g. final-quiz awards points inline) */
  skipPointsScreen?: boolean;
  /** Called when the rules screen is shown (landing → rules transition) */
  onRulesShow?: () => void;
  /** Called when the next-game screen is shown (after game + optional points) */
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
    setBackNavHandler: (fn: (() => void) | null) => void;
  }) => ReactNode;
}

export default function BaseGameWrapper({
  title,
  rules,
  totalQuestions,
  pointSystemEnabled,
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
  const [backNavHandler, setBackNavHandlerState] = useState<(() => void) | null>(null);

  const shouldShowPoints = !skipPointsScreen && (pointSystemEnabled || requiresPoints);

  const handleNav = useCallback(() => {
    if (phase === 'landing') {
      setPhase('rules');
      onRulesShow?.();
    } else if (phase === 'rules') {
      setPhase('game');
    } else if (phase === 'game') {
      navHandler?.();
    } else if (phase === 'next') {
      onNextGame();
    }
  }, [phase, navHandler, onNextGame]);

  const handleBackNav = useCallback(() => {
    if (phase === 'game') {
      backNavHandler?.();
    }
  }, [phase, backNavHandler]);

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
      setPhase('next');
      onNextShow?.();
    }
  }, [shouldShowPoints, onNextShow]);

  const handleComplete = useCallback(
    (winners: AwardPointsWinners) => {
      if (winners.team1) onAwardPoints('team1', pointValue);
      if (winners.team2) onAwardPoints('team2', pointValue);
      onNextGame();
    },
    [onAwardPoints, pointValue, onNextGame]
  );

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
          })}
        </div>
      )}

      {phase === 'points' && (
        <AwardPoints onComplete={handleComplete} />
      )}

      {phase === 'next' && (
        <div id="nextGameScreen" className="quiz-container">
          <button className="quiz-button next-game-button button-centered" onClick={onNextGame}>
            Nächstes Spiel
          </button>
        </div>
      )}
    </>
  );
}
