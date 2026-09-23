import { useState, useEffect, useCallback, useMemo } from 'react';
import type { GameComponentProps } from './types';
import type { QuizjagdConfig } from '@/types/config';
import type { GamemasterAnswerData, GamemasterControl, GamemasterCommand } from '@/types/game';
import BaseGameWrapper from './BaseGameWrapper';
import { useQuizAutoScroll } from '@/hooks/useQuizAutoScroll';
import { useQuestionOrder } from '@/hooks/useQuestionOrder';
import { useGameContext } from '@/context/GameContext';
import { teamName } from '@/utils/teamNames';
import { ALL_TEAM_KEYS, teamKeys, teamRoster, type TeamKey } from '@/utils/teams';
import TeamDot from '@/components/common/TeamDot';

type Difficulty = 'easy' | 'medium' | 'hard';
type Phase = 'betting' | 'question';

interface QuizjagdQ {
  question: string;
  answer: string;
}

interface TurnState {
  team: TeamKey;
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
      /* Quizjagd scores inline per turn, so the wrapper's end-of-game AwardPoints
         screen is always skipped — this is NOT the real point-system setting. */
      pointSystemEnabled={false}
      currentIndex={props.currentIndex}
      hideCorrectTracker
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
      onPrevGame={props.onPrevGame}
    >
      {({ onGameComplete, setNavHandler, setGamemasterData, setGamemasterControls, setCommandHandler, setNavState, setAnswerRevealed }) => (
        <QuizjagdInner
          config={config}
          gameId={props.gameId}
          pointSystemEnabled={props.pointSystemEnabled}
          onGameComplete={onGameComplete}
          setNavHandler={setNavHandler}
          onAwardPoints={props.onAwardPoints}
          setGamemasterData={setGamemasterData}
          setGamemasterControls={setGamemasterControls}
          setCommandHandler={setCommandHandler}
          setNavState={setNavState}
          setAnswerRevealed={setAnswerRevealed}
        />
      )}
    </BaseGameWrapper>
  );
}

interface InnerProps {
  config: QuizjagdConfig;
  gameId?: string;
  pointSystemEnabled: boolean;
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  onAwardPoints: (team: TeamKey, points: number) => void;
  setGamemasterData: (data: GamemasterAnswerData | null) => void;
  setGamemasterControls: (controls: GamemasterControl[]) => void;
  setCommandHandler: (fn: ((cmd: GamemasterCommand) => void) | null) => void;
  setNavState: (state: { hideForward?: boolean; hideBack?: boolean }) => void;
  setAnswerRevealed: (revealed: boolean) => void;
}

function QuizjagdInner({ config, gameId, pointSystemEnabled, onGameComplete, setNavHandler, onAwardPoints, setGamemasterData, setGamemasterControls, setCommandHandler, setNavState, setAnswerRevealed }: InnerProps) {
  const { state } = useGameContext();
  const questionsPerTeam = config.questionsPerTeam || 10;

  // Split the questions into the three difficulty pools. Supports both the flat
  // array (difficulty: 3/5/7) and the structured { easy, medium, hard } format.
  // The first entry of each pool is its Beispielfrage; `disabled` filtering and
  // the shuffle are left to useQuestionOrder below.
  const sources = useMemo(() => {
    const qs = config.questions as unknown;
    if (Array.isArray(qs)) {
      type FlatQ = QuizjagdQ & { difficulty: number; disabled?: boolean };
      const flat = qs as FlatQ[];
      return {
        easy: flat.filter(q => q.difficulty === 3),
        medium: flat.filter(q => q.difficulty === 5),
        hard: flat.filter(q => q.difficulty === 7),
      };
    }
    type StructQ = QuizjagdQ & { disabled?: boolean };
    const structured = qs as { easy: StructQ[]; medium: StructQ[]; hard: StructQ[] };
    return {
      easy: structured.easy || [],
      medium: structured.medium || [],
      hard: structured.hard || [],
    };
  }, [config.questions]);

  // One live-stable deck per difficulty. Each keeps its own session seed, so the
  // three pools shuffle independently and — crucially — do NOT re-deal when the
  // questions are edited mid-game. The previous unseeded shuffle sat in a
  // `useMemo(..., [config.questions])`, so every live edit re-dealt all three
  // decks while the consumed counter kept running: already-asked questions came
  // back around. See specs/live-question-order.md.
  const easy = useQuestionOrder(sources.easy, true, undefined, gameId && `${gameId}#easy`);
  const medium = useQuestionOrder(sources.medium, true, undefined, gameId && `${gameId}#medium`);
  const hard = useQuestionOrder(sources.hard, true, undefined, gameId && `${gameId}#hard`);
  const pools: Record<Difficulty, QuizjagdQ[]> = useMemo(
    () => ({ easy: easy.questions, medium: medium.questions, hard: hard.questions }),
    [easy.questions, medium.questions, hard.questions],
  );
  const slotKeys: Record<Difficulty, number[]> = useMemo(
    () => ({ easy: easy.order.slotKeys, medium: medium.order.slotKeys, hard: hard.order.slotKeys }),
    [easy.order, medium.order, hard.order],
  );

  // Which questions have already been asked, tracked by SLOT KEY rather than by a
  // per-pool cursor. A cursor would have to be remapped on every live edit;
  // identities need no remapping at all — a deleted question simply never comes
  // up again, and an added one queues at the end of its pool.
  const [used, setUsed] = useState<Record<Difficulty, number[]>>({ easy: [], medium: [], hard: [] });
  // Track which difficulty was used for the example round (null = not yet played)
  const [exampleDifficulty, setExampleDifficulty] = useState<Difficulty | null>(null);
  // Questions each team has already had. A record, not a pair — the turn order
  // is a round-robin over however many teams are in play. See specs/team-count.md.
  const activeTeams = useMemo(() => teamKeys(state.settings.teamCount), [state.settings.teamCount]);
  const [asked, setAsked] = useState<Partial<Record<TeamKey, number>>>({});
  const askedOf = useCallback((team: TeamKey) => asked[team] ?? 0, [asked]);
  const totalAsked = ALL_TEAM_KEYS.reduce((sum, k) => sum + (asked[k] ?? 0), 0);
  /** The team after `team` in the round-robin; wraps to the first. */
  const nextTeamAfter = useCallback((team: TeamKey): TeamKey => {
    const idx = activeTeams.indexOf(team);
    return activeTeams[(idx + 1) % Math.max(1, activeTeams.length)] ?? team;
  }, [activeTeams]);
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
      // Surface the active turn in the GM card during difficulty selection so
      // the GM doesn't see the generic "no game running" welcome screen.
      const teamLabel = teamName(state.teams, turn.team);
      setGamemasterData({
        gameTitle: config.title,
        questionNumber: 0,
        totalQuestions: questionsPerTeam * Math.max(1, activeTeams.length),
        answer: '',
        screenLabel: `${teamLabel} wählt Schwierigkeit`,
      });
    } else {
      const diffLabel = turn.difficulty === 'easy' ? 'Leicht' : turn.difficulty === 'medium' ? 'Mittel' : 'Schwer';
      setGamemasterData({
        gameTitle: config.title,
        questionNumber: totalAsked + (isCurrentExample ? 0 : 1),
        totalQuestions: questionsPerTeam * Math.max(1, activeTeams.length),
        question: currentQuestion.question,
        answer: currentQuestion.answer,
        extraInfo: diffLabel,
      });
    }
  }, [currentQuestion, turn.phase, turn.team, turn.difficulty, config.title, totalAsked, isCurrentExample, questionsPerTeam, activeTeams.length, setGamemasterData, state.teams]);

  // Index 0 is the example question in every pool — skip it once any example has been played
  const nextUnusedIn = useCallback(
    (d: Difficulty): number => {
      const from = exampleDifficulty !== null ? 1 : 0;
      const keys = slotKeys[d];
      for (let i = from; i < pools[d].length; i++) {
        if (!used[d].includes(keys[i]!)) return i;
      }
      return -1;
    },
    [pools, slotKeys, used, exampleDifficulty]
  );

  const pickQuestion = useCallback(
    (difficulty: Difficulty): QuizjagdQ | null => {
      const idx = nextUnusedIn(difficulty);
      if (idx < 0) return null;
      const key = slotKeys[difficulty][idx]!;
      setUsed(prev => ({ ...prev, [difficulty]: [...prev[difficulty], key] }));
      return pools[difficulty][idx]!;
    },
    [pools, slotKeys, nextUnusedIn]
  );

  const isDifficultyExhausted = useCallback(
    (d: Difficulty) => nextUnusedIn(d) < 0,
    [nextUnusedIn]
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

  // Points off: advance a turn without judging/awarding — mirror the counting +
  // team-switch + completion logic of handleJudgment, minus the points. The
  // example round just returns to difficulty selection (no count, same team).
  const advanceTurn = useCallback(() => {
    if (isCurrentExample) {
      setShowAnswer(false);
      setCurrentQuestion(null);
      setIsCurrentExample(false);
      setTurn(prev => ({ ...prev, difficulty: null, points: 0, phase: 'betting', showCorrectButtons: false }));
      return;
    }
    const nextAsked = { ...asked, [turn.team]: askedOf(turn.team) + 1 };
    setAsked(nextAsked);
    if (activeTeams.every(t => (nextAsked[t] ?? 0) >= questionsPerTeam)) {
      onGameComplete();
      return;
    }
    const nextTeam = nextTeamAfter(turn.team);
    setShowAnswer(false);
    setCurrentQuestion(null);
    setTurn({ team: nextTeam, difficulty: null, points: 0, phase: 'betting', showCorrectButtons: false });
  }, [isCurrentExample, turn.team, asked, askedOf, activeTeams, nextTeamAfter, questionsPerTeam, onGameComplete]);

  const handleNext = useCallback(() => {
    if (turn.phase !== 'question') return;
    if (!showAnswer) {
      // Reveal the answer. With points on this also arms the Richtig/Falsch
      // judging buttons; with points off there's no judging — a further
      // nav-forward simply advances to the next turn.
      setShowAnswer(true);
      if (pointSystemEnabled) setTurn(prev => ({ ...prev, showCorrectButtons: true }));
    } else if (!pointSystemEnabled) {
      advanceTurn();
    }
  }, [turn.phase, showAnswer, pointSystemEnabled, advanceTurn]);

  // Signal answer-reveal so the GM-triggered deadline timer hides immediately.
  useEffect(() => {
    setAnswerRevealed(showAnswer);
  }, [showAnswer, setAnswerRevealed]);

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

        const nextAsked = { ...asked, [turn.team]: askedOf(turn.team) + 1 };
        setAsked(nextAsked);

        if (activeTeams.every(t => (nextAsked[t] ?? 0) >= questionsPerTeam)) {
          onGameComplete();
          return;
        }

        const nextTeam = nextTeamAfter(turn.team);
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
    [currentQuestion, turn, asked, askedOf, activeTeams, nextTeamAfter, questionsPerTeam, onAwardPoints, onGameComplete]
  );

  // All three pools dry while both teams still have turns left = a dead end.
  // Previously the show simply sat on the difficulty screen with every button
  // greyed out, no GM arrows and ArrowRight doing nothing; the only way out was
  // ArrowLeft, which — because Quizjagd registers no backNavHandler — dropped
  // BaseGameWrapper to the rules phase and unmounted the game, losing the round.
  // Finish the game instead. `validate-config` now also rejects a config that
  // cannot supply questionsPerTeam × 2 questions, so this should stay unreachable.
  const allPoolsExhausted =
    isDifficultyExhausted('easy') && isDifficultyExhausted('medium') && isDifficultyExhausted('hard');

  useEffect(() => {
    if (turn.phase === 'betting' && allPoolsExhausted) {
      onGameComplete();
    }
  }, [turn.phase, allPoolsExhausted, onGameComplete]);

  // Broadcast gamemaster controls
  useEffect(() => {
    const controls: GamemasterControl[] = [];
    // Difficulty pick + post-reveal judging are both nav-inert. Only the
    // question-shown-but-no-answer-yet step uses nav-forward to reveal.
    if (turn.phase === 'betting' || turn.showCorrectButtons) {
      setNavState({ hideForward: true, hideBack: true });
    } else {
      setNavState({});
    }
    if (turn.phase === 'betting') {
      // Point values are part of the label only when the point system is on.
      const dl = pointSystemEnabled
        ? { easy: '3 Punkte (Leicht)', medium: '5 Punkte (Mittel)', hard: '7 Punkte (Schwer)' }
        : { easy: 'Leicht', medium: 'Mittel', hard: 'Schwer' };
      controls.push({
        type: 'button-group',
        id: 'difficulty',
        label: 'Schwierigkeit wählen',
        buttons: [
          { id: 'difficulty-easy', label: dl.easy, disabled: isDifficultyExhausted('easy') },
          { id: 'difficulty-medium', label: dl.medium, disabled: isDifficultyExhausted('medium') },
          { id: 'difficulty-hard', label: dl.hard, disabled: isDifficultyExhausted('hard') },
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
  }, [turn.phase, turn.showCorrectButtons, pointSystemEnabled, isDifficultyExhausted, setGamemasterControls, setNavState]);

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

  // Scroll the card just below the sticky header when it overflows — same
  // behaviour as SimpleQuiz. During judging the Richtig/Falsch buttons are the
  // actionable content at the bottom, so anchor the bottom into view instead.
  useQuizAutoScroll(
    `${turn.phase}:${showAnswer}:${turn.showCorrectButtons}`,
    turn.showCorrectButtons ? 'bottom' : 'top',
  );

  const currentTeamCount = askedOf(turn.team);
  const teamLabel = teamName(state.teams, turn.team);
  const teamPlayers: string[] = teamRoster(state.teams, turn.team);

  return (
    <>
      <h2 className="quiz-question-number">
        {isCurrentExample || (exampleDifficulty === null && turn.phase === 'betting')
          ? 'Beispiel'
          : `Frage ${currentTeamCount + 1} von ${questionsPerTeam}`}
        {pointSystemEnabled && turn.phase === 'question' && turn.difficulty
          ? ` · ${turn.points} Punkte`
          : ''}
      </h2>
      {(exampleDifficulty !== null || turn.phase === 'question' || turn.phase === 'betting') && (
        <p className="quizjagd-team-label" data-team={turn.team}>
          <TeamDot team={turn.team} />{teamLabel} ist dran{teamPlayers.length > 0 ? ` · ${teamPlayers.join(' & ')}` : ''}
        </p>
      )}

      {turn.phase === 'betting' && (
        <div className="button-row">
          <button
            className="quiz-button"
            onClick={() => selectDifficulty('easy')}
            disabled={isDifficultyExhausted('easy')}
          >
            {pointSystemEnabled ? '3 Punkte (Leicht)' : 'Leicht'}
          </button>
          <button
            className="quiz-button"
            onClick={() => selectDifficulty('medium')}
            disabled={isDifficultyExhausted('medium')}
          >
            {pointSystemEnabled ? '5 Punkte (Mittel)' : 'Mittel'}
          </button>
          <button
            className="quiz-button"
            onClick={() => selectDifficulty('hard')}
            disabled={isDifficultyExhausted('hard')}
          >
            {pointSystemEnabled ? '7 Punkte (Schwer)' : 'Schwer'}
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
