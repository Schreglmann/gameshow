import { useState, useEffect, useCallback, useMemo } from 'react';
import type { GameComponentProps } from './types';
import type { QuizjagdConfig } from '@/types/config';
import BaseGameWrapper from './BaseGameWrapper';
import { useGameContext } from '@/context/GameContext';

type Difficulty = 'easy' | 'medium' | 'hard';
type Phase = 'betting' | 'question';

interface QuizjagdQ {
  question: string;
  answer: string;
  isExample?: boolean;
}

interface TurnState {
  team: 'team1' | 'team2';
  difficulty: Difficulty | null;
  points: number;
  phase: Phase;
  showCorrectButtons: boolean;
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
      pointSystemEnabled={false}
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

  // Build pools: example questions at front (like main branch), then shuffled regulars.
  // Supports both flat array (difficulty: 3/5/7) and structured { easy, medium, hard }.
  const pools = useMemo(() => {
    const qs = config.questions as unknown;
    const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5);
    if (Array.isArray(qs)) {
      type FlatQ = { question: string; answer: string; difficulty: number; isExample?: boolean };
      const flatArr = qs as FlatQ[];
      const toQ = (q: FlatQ): QuizjagdQ => ({ question: q.question, answer: q.answer, isExample: q.isExample });
      return {
        easy: [
          ...flatArr.filter(q => q.difficulty === 3 && q.isExample).map(toQ),
          ...shuffle(flatArr.filter(q => q.difficulty === 3 && !q.isExample).map(toQ)),
        ],
        medium: [
          ...flatArr.filter(q => q.difficulty === 5 && q.isExample).map(toQ),
          ...shuffle(flatArr.filter(q => q.difficulty === 5 && !q.isExample).map(toQ)),
        ],
        hard: [
          ...flatArr.filter(q => q.difficulty === 7 && q.isExample).map(toQ),
          ...shuffle(flatArr.filter(q => q.difficulty === 7 && !q.isExample).map(toQ)),
        ],
      };
    }
    // Structured format: { easy, medium, hard }
    const structured = qs as { easy: QuizjagdQ[]; medium: QuizjagdQ[]; hard: QuizjagdQ[] };
    return {
      easy: shuffle([...(structured.easy || [])]),
      medium: shuffle([...(structured.medium || [])]),
      hard: shuffle([...(structured.hard || [])]),
    };
  }, [config.questions]);

  const [poolIndex, setPoolIndex] = useState({ easy: 0, medium: 0, hard: 0 });
  // exampleShown: false = still on the example round (first betting screen)
  const hasExamples = useMemo(
    () => Object.values(pools).some(p => p.some(q => q.isExample)),
    [pools]
  );
  const [exampleShown, setExampleShown] = useState(!hasExamples); // skip example phase if no examples
  const [team1Count, setTeam1Count] = useState(0);
  const [team2Count, setTeam2Count] = useState(0);
  const [turn, setTurn] = useState<TurnState>({
    team: 'team1',
    difficulty: null,
    points: 0,
    phase: 'betting',
    showCorrectButtons: false,
  });
  const [currentQuestion, setCurrentQuestion] = useState<QuizjagdQ | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);

  // Skip example entries in pool when exampleShown is true
  const pickQuestion = useCallback(
    (difficulty: Difficulty): QuizjagdQ | null => {
      const pool = pools[difficulty];
      let idx = poolIndex[difficulty];
      // Skip example questions once example has been shown
      while (idx < pool.length && pool[idx].isExample && exampleShown) idx++;
      if (idx >= pool.length) return null;
      setPoolIndex(prev => ({ ...prev, [difficulty]: idx + 1 }));
      return pool[idx];
    },
    [pools, poolIndex, exampleShown]
  );

  const isDifficultyExhausted = useCallback(
    (d: Difficulty) => {
      const pool = pools[d];
      let idx = poolIndex[d];
      while (idx < pool.length && pool[idx]?.isExample && exampleShown) idx++;
      return idx >= pool.length;
    },
    [pools, poolIndex, exampleShown]
  );

  const selectDifficulty = useCallback(
    (d: Difficulty) => {
      const q = pickQuestion(d);
      if (!q) return;
      // If this is an example question, mark example as shown
      if (q.isExample && !exampleShown) setExampleShown(true);
      const pts = getDifficultyPoints(d);
      setCurrentQuestion(q);
      setTurn(prev => ({ ...prev, difficulty: d, points: pts, phase: 'question', showCorrectButtons: false }));
      setShowAnswer(false);
    },
    [pickQuestion, exampleShown]
  );

  const handleNext = useCallback(() => {
    if (turn.phase === 'question' && !showAnswer) {
      setShowAnswer(true);
      setTurn(prev => ({ ...prev, showCorrectButtons: true }));
    }
  }, [turn.phase, showAnswer]);

  useEffect(() => {
    setNavHandler(handleNext);
  }, [handleNext, setNavHandler]);

  const handleJudgment = useCallback(
    (correct: boolean) => {
      const isExampleQuestion = currentQuestion?.isExample ?? false;

      if (!isExampleQuestion) {
        const pts = turn.points;
        const team = turn.team;

        if (correct) {
          onAwardPoints(team, pts);
        } else {
          onAwardPoints(team, -pts);
        }

        const t1 = turn.team === 'team1' ? team1Count + 1 : team1Count;
        const t2 = turn.team === 'team2' ? team2Count + 1 : team2Count;
        setTeam1Count(t1);
        setTeam2Count(t2);

        if (t1 >= questionsPerTeam && t2 >= questionsPerTeam) {
          onGameComplete();
          return;
        }

        const nextTeam = turn.team === 'team1' ? 'team2' : 'team1';
        setShowAnswer(false);
        setCurrentQuestion(null);
        setTurn({ team: nextTeam, difficulty: null, points: 0, phase: 'betting', showCorrectButtons: false });
      } else {
        // Example question: no points, no team switch — go back to betting
        setShowAnswer(false);
        setCurrentQuestion(null);
        setTurn(prev => ({ ...prev, difficulty: null, points: 0, phase: 'betting', showCorrectButtons: false }));
      }
    },
    [currentQuestion, turn, team1Count, team2Count, questionsPerTeam, onAwardPoints, onGameComplete]
  );

  const { state } = useGameContext();
  const currentTeamCount = turn.team === 'team1' ? team1Count : team2Count;
  const teamLabel = turn.team === 'team1' ? 'Team 1' : 'Team 2';
  const teamPlayers: string[] = turn.team === 'team1' ? state.teams.team1 : state.teams.team2;

  return (
    <>
      <h2 className="quiz-question-number">
        {!exampleShown && turn.phase === 'betting'
          ? 'Beispiel'
          : currentQuestion?.isExample
            ? 'Beispiel'
            : `Frage ${currentTeamCount + 1} von ${questionsPerTeam}`}
        {turn.phase === 'question' && turn.difficulty
          ? ` · ${turn.points} Punkte`
          : ''}
      </h2>
      {(exampleShown || turn.phase === 'question' || turn.phase === 'betting') && (
        <p className="quizjagd-team-label">
          {teamLabel} ist dran{teamPlayers.length > 0 ? ` · ${teamPlayers.join(' & ')}` : ''}
        </p>
      )}

      {turn.phase === 'betting' && (
        <div className="button-row">
          <button
            className="quiz-button"
            onClick={() => selectDifficulty('easy')}
            disabled={isDifficultyExhausted('easy')}
          >
            3 Punkte (Leicht)
          </button>
          <button
            className="quiz-button"
            onClick={() => selectDifficulty('medium')}
            disabled={isDifficultyExhausted('medium')}
          >
            5 Punkte (Mittel)
          </button>
          <button
            className="quiz-button"
            onClick={() => selectDifficulty('hard')}
            disabled={isDifficultyExhausted('hard')}
          >
            7 Punkte (Schwer)
          </button>
        </div>
      )}

      {/* Question screen */}
      {turn.phase === 'question' && currentQuestion && (
        <>
          <p className="quiz-question">{currentQuestion.question}</p>

          {showAnswer && (
            <div className="quiz-answer">
              <p>{currentQuestion.answer}</p>
            </div>
          )}

          {turn.showCorrectButtons && (
            <div className="judgment-group">
              <button
                className="quiz-button"
                style={{ background: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' }}
                onClick={() => handleJudgment(true)}
              >
                ✓ Richtig
              </button>
              <button
                className="quiz-button"
                style={{ background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' }}
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
