import { useState, useEffect, useCallback, useMemo } from 'react';
import type { GameComponentProps } from './types';
import type { QuizjagdConfig, QuizjagdQuestion } from '@/types/config';
import BaseGameWrapper from './BaseGameWrapper';

type Difficulty = 'easy' | 'medium' | 'hard';
type Phase = 'betting' | 'question' | 'answer';

interface TurnState {
  team: 'team1' | 'team2';
  difficulty: Difficulty | null;
  points: number;
  questionIndex: number;
  phase: Phase;
  showCorrectButtons: boolean;
}

function getDifficultyLabel(d: Difficulty): string {
  return d === 'easy' ? 'Leicht' : d === 'medium' ? 'Mittel' : 'Schwer';
}

function getDifficultyPoints(d: Difficulty): number {
  return d === 'easy' ? 3 : d === 'medium' ? 5 : 7;
}

export default function Quizjagd(props: GameComponentProps) {
  const config = props.config as QuizjagdConfig;

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || ['Teams wählen abwechselnd die Schwierigkeit der Frage.']}
      pointSystemEnabled={props.pointSystemEnabled}
      requiresPoints
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
    >
      {({ onGameComplete, setNavHandler }) => (
        <QuizjagdInner
          config={config}
          onGameComplete={onGameComplete}
          setNavHandler={setNavHandler}
          onAwardPoints={props.onAwardPoints}
        />
      )}
    </BaseGameWrapper>
  );
}

interface InnerProps {
  config: QuizjagdConfig;
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  onAwardPoints: (team: 'team1' | 'team2', points: number) => void;
}

function QuizjagdInner({ config, onGameComplete, setNavHandler, onAwardPoints }: InnerProps) {
  const questionsPerTeam = config.questionsPerTeam || 10;

  // Shuffle question pools
  const pools = useMemo(() => {
    const qs = config.questions;
    return {
      easy: [...qs.easy].sort(() => Math.random() - 0.5),
      medium: [...qs.medium].sort(() => Math.random() - 0.5),
      hard: [...qs.hard].sort(() => Math.random() - 0.5),
    };
  }, [config.questions]);

  const [poolIndex, setPoolIndex] = useState({ easy: 0, medium: 0, hard: 0 });
  const [turnNumber, setTurnNumber] = useState(0); // 0 = example
  const [isExample, setIsExample] = useState(!!config.exampleQuestion);
  const [turn, setTurn] = useState<TurnState>({
    team: 'team1',
    difficulty: null,
    points: 0,
    questionIndex: 0,
    phase: isExample ? 'question' : 'betting',
    showCorrectButtons: false,
  });
  const [currentQuestion, setCurrentQuestion] = useState<QuizjagdQuestion | null>(
    config.exampleQuestion || null
  );
  const [showAnswer, setShowAnswer] = useState(false);
  const [team1Score, setTeam1Score] = useState(0);
  const [team2Score, setTeam2Score] = useState(0);
  const totalTurns = questionsPerTeam * 2;
  const questionNumber = isExample ? 0 : turnNumber;

  const pickQuestion = useCallback(
    (difficulty: Difficulty): QuizjagdQuestion | null => {
      const pool = pools[difficulty];
      const idx = poolIndex[difficulty];
      if (idx >= pool.length) return null;
      setPoolIndex(prev => ({ ...prev, [difficulty]: prev[difficulty] + 1 }));
      return pool[idx];
    },
    [pools, poolIndex]
  );

  const isDifficultyExhausted = useCallback(
    (d: Difficulty) => poolIndex[d] >= pools[d].length,
    [poolIndex, pools]
  );

  const selectDifficulty = useCallback(
    (d: Difficulty) => {
      const q = pickQuestion(d);
      if (!q) return;
      const pts = getDifficultyPoints(d);
      setCurrentQuestion(q);
      setTurn(prev => ({
        ...prev,
        difficulty: d,
        points: pts,
        phase: 'question',
      }));
      setShowAnswer(false);
    },
    [pickQuestion]
  );

  const handleNext = useCallback(() => {
    if (isExample) {
      if (!showAnswer) {
        setShowAnswer(true);
        setTurn(prev => ({ ...prev, showCorrectButtons: true }));
      } else {
        // End example, start real game
        setIsExample(false);
        setTurnNumber(1);
        setShowAnswer(false);
        setCurrentQuestion(null);
        setTurn({
          team: 'team1',
          difficulty: null,
          points: 0,
          questionIndex: 0,
          phase: 'betting',
          showCorrectButtons: false,
        });
      }
      return;
    }

    if (turn.phase === 'question' && !showAnswer) {
      setShowAnswer(true);
      setTurn(prev => ({ ...prev, showCorrectButtons: true }));
    }
  }, [isExample, showAnswer, turn.phase]);

  useEffect(() => {
    setNavHandler(handleNext);
  }, [handleNext, setNavHandler]);

  const handleJudgment = useCallback(
    (correct: boolean) => {
      if (isExample) {
        // No points for example
        setShowAnswer(true);
        setTurn(prev => ({ ...prev, showCorrectButtons: false }));
        return;
      }

      const pts = turn.points;
      const team = turn.team;

      if (correct) {
        const delta = pts;
        onAwardPoints(team, delta);
        if (team === 'team1') setTeam1Score(prev => prev + delta);
        else setTeam2Score(prev => prev + delta);
      } else {
        // Lose points but not below 0
        const currentScore = team === 'team1' ? team1Score : team2Score;
        const loss = Math.min(pts, currentScore);
        if (loss > 0) {
          onAwardPoints(team, -loss);
          if (team === 'team1') setTeam1Score(prev => prev - loss);
          else setTeam2Score(prev => prev - loss);
        }
      }

      // Move to next turn
      const nextTurn = turnNumber + 1;
      if (nextTurn > totalTurns) {
        onGameComplete();
        return;
      }

      setTurnNumber(nextTurn);
      const nextTeam = turn.team === 'team1' ? 'team2' : 'team1';
      setShowAnswer(false);
      setCurrentQuestion(null);
      setTurn({
        team: nextTeam,
        difficulty: null,
        points: 0,
        questionIndex: 0,
        phase: 'betting',
        showCorrectButtons: false,
      });
    },
    [isExample, turn, turnNumber, totalTurns, onAwardPoints, onGameComplete, team1Score, team2Score]
  );

  const headerText = isExample
    ? 'Beispiel Frage'
    : `${turn.team === 'team1' ? 'Team 1' : 'Team 2'} ist dran`;

  return (
    <>
      <div
        id="quizjagdHeader"
        style={{
          textAlign: 'center',
          marginBottom: 30,
          padding: 15,
          background: 'rgba(255,255,255,0.1)',
          borderRadius: 10,
        }}
      >
        <h3 style={{ margin: '0 0 10px', fontSize: '1.2em', color: '#ffd700' }}>
          {isExample ? 'Beispiel' : `Frage ${questionNumber} von ${totalTurns}`}
        </h3>
        {turn.difficulty && (
          <h2 style={{ margin: '0 0 10px', fontSize: '2em' }}>{turn.points} Punkte</h2>
        )}
        <h2 style={{ margin: 0, fontSize: '1.5em' }}>{headerText}</h2>
      </div>

      {turn.phase === 'betting' && !isExample && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ margin: '20px 0' }}>
            <button
              className="quiz-button"
              style={{ margin: 10 }}
              onClick={() => selectDifficulty('easy')}
              disabled={isDifficultyExhausted('easy')}
            >
              3 Punkte (Leicht)
            </button>
            <button
              className="quiz-button"
              style={{ margin: 10 }}
              onClick={() => selectDifficulty('medium')}
              disabled={isDifficultyExhausted('medium')}
            >
              5 Punkte (Mittel)
            </button>
            <button
              className="quiz-button"
              style={{ margin: 10 }}
              onClick={() => selectDifficulty('hard')}
              disabled={isDifficultyExhausted('hard')}
            >
              7 Punkte (Schwer)
            </button>
          </div>
        </div>
      )}

      {(turn.phase === 'question' || isExample) && currentQuestion && (
        <>
          {turn.difficulty && (
            <h3 style={{ color: '#ffd700', marginBottom: 20 }}>
              {getDifficultyLabel(turn.difficulty)} – {turn.points} Punkte
            </h3>
          )}
          <p style={{ fontSize: '1.5em', marginBottom: 30 }}>{currentQuestion.question}</p>

          {showAnswer && (
            <div className="quiz-answer">
              <p style={{ fontSize: '1.6em', fontWeight: 600 }}>{currentQuestion.answer}</p>
            </div>
          )}

          {turn.showCorrectButtons && (
            <div style={{ marginTop: 20 }}>
              <button
                className="quiz-button"
                style={{
                  margin: 10,
                  background: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
                }}
                onClick={() => handleJudgment(true)}
              >
                ✓ Richtig
              </button>
              <button
                className="quiz-button"
                style={{
                  margin: 10,
                  background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
                }}
                onClick={() => handleJudgment(false)}
              >
                ✗ Falsch
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
