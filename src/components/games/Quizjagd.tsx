import { useState, useEffect, useCallback, useMemo } from 'react';
import type { GameComponentProps } from './types';
import type { QuizjagdConfig } from '@/types/config';
import type { GamemasterAnswerData, GamemasterControl, GamemasterCommand } from '@/types/game';
import BaseGameWrapper from './BaseGameWrapper';
import { useGameContext } from '@/context/GameContext';

type Difficulty = 'easy' | 'medium' | 'hard';
type Phase = 'betting' | 'question';

interface QuizjagdQ {
  question: string;
  answer: string;
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
      currentIndex={props.currentIndex}
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
    >
      {({ onGameComplete, setNavHandler, setGamemasterData, setGamemasterControls, setCommandHandler }) => (
        <QuizjagdInner
          config={config}
          onGameComplete={onGameComplete}
          setNavHandler={setNavHandler}
          onAwardPoints={props.onAwardPoints}
          setGamemasterData={setGamemasterData}
          setGamemasterControls={setGamemasterControls}
          setCommandHandler={setCommandHandler}
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
  setGamemasterData: (data: GamemasterAnswerData | null) => void;
  setGamemasterControls: (controls: GamemasterControl[]) => void;
  setCommandHandler: (fn: ((cmd: GamemasterCommand) => void) | null) => void;
}

function QuizjagdInner({ config, onGameComplete, setNavHandler, onAwardPoints, setGamemasterData, setGamemasterControls, setCommandHandler }: InnerProps) {
  const questionsPerTeam = config.questionsPerTeam || 10;

  // Build pools: example questions at front (like main branch), then shuffled regulars.
  // Supports both flat array (difficulty: 3/5/7) and structured { easy, medium, hard }.
  const pools = useMemo(() => {
    const qs = config.questions as unknown;
    const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5);
    // First question per difficulty is the example, rest are shuffled
    const buildPool = (arr: { question: string; answer: string }[]): QuizjagdQ[] => {
      if (arr.length === 0) return [];
      const [example, ...rest] = arr;
      return [{ question: example.question, answer: example.answer }, ...shuffle(rest.map(q => ({ question: q.question, answer: q.answer })))];
    };
    if (Array.isArray(qs)) {
      type FlatQ = { question: string; answer: string; difficulty: number; disabled?: boolean };
      const flatArr = (qs as FlatQ[]).filter(q => !q.disabled);
      return {
        easy: buildPool(flatArr.filter(q => q.difficulty === 3)),
        medium: buildPool(flatArr.filter(q => q.difficulty === 5)),
        hard: buildPool(flatArr.filter(q => q.difficulty === 7)),
      };
    }
    // Structured format: { easy, medium, hard }
    type StructQ = QuizjagdQ & { disabled?: boolean };
    const structured = qs as { easy: StructQ[]; medium: StructQ[]; hard: StructQ[] };
    return {
      easy: buildPool([...(structured.easy || [])].filter(q => !q.disabled)),
      medium: buildPool([...(structured.medium || [])].filter(q => !q.disabled)),
      hard: buildPool([...(structured.hard || [])].filter(q => !q.disabled)),
    };
  }, [config.questions]);

  const [poolIndex, setPoolIndex] = useState({ easy: 0, medium: 0, hard: 0 });
  // Track which difficulty was used for the example round (null = not yet played)
  const [exampleDifficulty, setExampleDifficulty] = useState<Difficulty | null>(null);
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
  const [isCurrentExample, setIsCurrentExample] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);

  useEffect(() => {
    if (turn.phase === 'betting' || !currentQuestion) {
      setGamemasterData(null);
    } else {
      const diffLabel = turn.difficulty === 'easy' ? 'Leicht' : turn.difficulty === 'medium' ? 'Mittel' : 'Schwer';
      setGamemasterData({
        gameTitle: config.title,
        questionNumber: team1Count + team2Count + (isCurrentExample ? 0 : 1),
        totalQuestions: questionsPerTeam * 2,
        answer: currentQuestion.answer,
        extraInfo: diffLabel,
      });
    }
  }, [currentQuestion, turn.phase, turn.difficulty, config.title, team1Count, team2Count, isCurrentExample, questionsPerTeam, setGamemasterData]);

  // Index 0 is the example question in every pool — skip it once any example has been played
  const pickQuestion = useCallback(
    (difficulty: Difficulty): QuizjagdQ | null => {
      const pool = pools[difficulty];
      let idx = poolIndex[difficulty];
      // After the example round, skip index 0 for ALL difficulties (each pool's first Q is a Beispielfrage)
      if (idx === 0 && exampleDifficulty !== null) idx = 1;
      if (idx >= pool.length) return null;
      setPoolIndex(prev => ({ ...prev, [difficulty]: idx + 1 }));
      return pool[idx];
    },
    [pools, poolIndex, exampleDifficulty]
  );

  const isDifficultyExhausted = useCallback(
    (d: Difficulty) => {
      const pool = pools[d];
      let idx = poolIndex[d];
      if (idx === 0 && exampleDifficulty !== null) idx = 1;
      return idx >= pool.length;
    },
    [pools, poolIndex, exampleDifficulty]
  );

  const selectDifficulty = useCallback(
    (d: Difficulty) => {
      const q = pickQuestion(d);
      if (!q) return;
      const isExample = exampleDifficulty === null;
      if (isExample) setExampleDifficulty(d);
      setIsCurrentExample(isExample);
      const pts = getDifficultyPoints(d);
      setCurrentQuestion(q);
      setTurn(prev => ({ ...prev, difficulty: d, points: pts, phase: 'question', showCorrectButtons: false }));
      setShowAnswer(false);
    },
    [pickQuestion, exampleDifficulty]
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
      if (!isCurrentExample) {
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
        setIsCurrentExample(false);
        setTurn(prev => ({ ...prev, difficulty: null, points: 0, phase: 'betting', showCorrectButtons: false }));
      }
    },
    [currentQuestion, turn, team1Count, team2Count, questionsPerTeam, onAwardPoints, onGameComplete]
  );

  // Broadcast gamemaster controls
  useEffect(() => {
    const controls: GamemasterControl[] = [];
    if (turn.phase === 'betting') {
      controls.push({
        type: 'button-group',
        id: 'difficulty',
        label: 'Schwierigkeit wählen',
        buttons: [
          { id: 'difficulty-easy', label: '3 Punkte (Leicht)', disabled: isDifficultyExhausted('easy') },
          { id: 'difficulty-medium', label: '5 Punkte (Mittel)', disabled: isDifficultyExhausted('medium') },
          { id: 'difficulty-hard', label: '7 Punkte (Schwer)', disabled: isDifficultyExhausted('hard') },
        ],
      });
    }
    if (turn.showCorrectButtons) {
      controls.push({
        type: 'button-group',
        id: 'judgment',
        label: 'Bewertung',
        buttons: [
          { id: 'judgment-correct', label: 'Richtig', variant: 'success' },
          { id: 'judgment-incorrect', label: 'Falsch', variant: 'danger' },
        ],
      });
    }
    setGamemasterControls(controls);
  }, [turn.phase, turn.showCorrectButtons, isDifficultyExhausted, setGamemasterControls]);

  // Handle gamemaster commands
  const commandHandlerFn = useCallback((cmd: GamemasterCommand) => {
    if (cmd.controlId === 'difficulty-easy') selectDifficulty('easy');
    else if (cmd.controlId === 'difficulty-medium') selectDifficulty('medium');
    else if (cmd.controlId === 'difficulty-hard') selectDifficulty('hard');
    else if (cmd.controlId === 'judgment-correct') handleJudgment(true);
    else if (cmd.controlId === 'judgment-incorrect') handleJudgment(false);
  }, [selectDifficulty, handleJudgment]);

  useEffect(() => {
    setCommandHandler(commandHandlerFn);
  }, [commandHandlerFn, setCommandHandler]);

  const { state } = useGameContext();
  const currentTeamCount = turn.team === 'team1' ? team1Count : team2Count;
  const teamLabel = turn.team === 'team1' ? 'Team 1' : 'Team 2';
  const teamPlayers: string[] = turn.team === 'team1' ? state.teams.team1 : state.teams.team2;

  return (
    <>
      <h2 className="quiz-question-number">
        {isCurrentExample || (exampleDifficulty === null && turn.phase === 'betting')
          ? 'Beispiel'
          : `Frage ${currentTeamCount + 1} von ${questionsPerTeam}`}
        {turn.phase === 'question' && turn.difficulty
          ? ` · ${turn.points} Punkte`
          : ''}
      </h2>
      {(exampleDifficulty !== null || turn.phase === 'question' || turn.phase === 'betting') && (
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
                style={{ background: 'linear-gradient(135deg, var(--success-alt-from) 0%, var(--success-alt-to) 100%)' }}
                onClick={() => handleJudgment(true)}
              >
                ✓ Richtig
              </button>
              <button
                className="quiz-button"
                style={{ background: 'linear-gradient(135deg, var(--accent-from) 0%, var(--accent-to) 100%)' }}
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
