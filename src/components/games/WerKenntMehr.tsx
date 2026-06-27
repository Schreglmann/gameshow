import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { GameComponentProps } from './types';
import type { WerKenntMehrConfig, WerKenntMehrQuestion, SimpleQuizQuestion } from '@/types/config';
import type { GamemasterAnswerData, GamemasterControl, GamemasterCommand } from '@/types/game';
import { useGameContext } from '@/context/GameContext';
import { teamName } from '@/utils/teamNames';
import { useShuffledQuestions } from '@/hooks/useShuffledQuestions';
import { useQuizAutoScroll } from '@/hooks/useQuizAutoScroll';
import BaseGameWrapper from './BaseGameWrapper';
import QuizQuestionView from './QuizQuestionView';

export default function WerKenntMehr(props: GameComponentProps) {
  const config = props.config as WerKenntMehrConfig;
  const questions = useShuffledQuestions(config.questions, config.randomizeQuestions, config.questionLimit);
  const totalQuestions = questions.length > 0 ? questions.length - 1 : 0;
  const scoringMode = config.scoringMode ?? 'standard';

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || [
        'Beide Teams nennen nacheinander so viele passende Begriffe wie möglich.',
        'Das Team mit den meisten richtigen Nennungen gewinnt die Runde.',
        // 'standard' (default) scores like every other game (positional points), so
        // it carries no count-based scoring line. 'count' / 'count-penalty' do.
        ...(scoringMode === 'count'
          ? [
              'Der Gewinner erhält so viele Punkte, wie es Begriffe genannt hat.',
              'Bei Gleichstand teilen sich beide Teams die Punkte.',
            ]
          : scoringMode === 'count-penalty'
            ? [
                'Der Gewinner erhält so viele Punkte, wie es Begriffe genannt hat.',
                'Das unterlegene Team verliert ebenso viele Punkte.',
                'Bei Gleichstand bleibt der Punktestand unverändert.',
              ]
            : []),
      ]}
      totalQuestions={totalQuestions}
      pointSystemEnabled={props.pointSystemEnabled}
      pointValue={props.currentIndex + 1}
      currentIndex={props.currentIndex}
      requiresPoints
      skipPointsScreen
      hideCorrectTracker
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
    >
      {({ onGameComplete, setNavHandler, setBackNavHandler, setGamemasterData, setGamemasterControls, setCommandHandler, setNavState, deadlineActive, setAnswerRevealed, timerPaused, setGameTimerActive, setStopGameTimerHandler }) => (
        <WerKenntMehrInner
          questions={questions}
          gameTitle={config.title}
          scoringMode={scoringMode}
          pointValue={props.currentIndex + 1}
          onGameComplete={onGameComplete}
          onAwardPoints={props.onAwardPoints}
          setNavHandler={setNavHandler}
          setBackNavHandler={setBackNavHandler}
          setGamemasterData={setGamemasterData}
          setGamemasterControls={setGamemasterControls}
          setCommandHandler={setCommandHandler}
          setNavState={setNavState}
          deadlineActive={deadlineActive}
          setAnswerRevealed={setAnswerRevealed}
          timerPaused={timerPaused}
          setGameTimerActive={setGameTimerActive}
          setStopGameTimerHandler={setStopGameTimerHandler}
        />
      )}
    </BaseGameWrapper>
  );
}

type Phase = 'question' | 'answer' | 'summary';

interface InnerProps {
  questions: WerKenntMehrQuestion[];
  gameTitle: string;
  /** 'standard' (default): tally round wins and award the positional game points to
   *  the leader on a final confirm screen. 'count': award the entered item count
   *  inline. 'count-penalty': like 'count', but the losing team also loses the
   *  entered count (clamped at 0); a tie does nothing. */
  scoringMode: 'count' | 'standard' | 'count-penalty';
  /** Positional game points (currentIndex + 1) awarded to the winner in standard mode. */
  pointValue: number;
  onGameComplete: () => void;
  onAwardPoints: (team: 'team1' | 'team2', points: number) => void;
  setNavHandler: (fn: (() => void) | null) => void;
  setBackNavHandler: (fn: (() => boolean) | null) => void;
  setGamemasterData: (data: GamemasterAnswerData | null) => void;
  setGamemasterControls: (controls: GamemasterControl[]) => void;
  setCommandHandler: (fn: ((cmd: GamemasterCommand) => void) | null) => void;
  setNavState: (state: { hideForward?: boolean; hideBack?: boolean }) => void;
  deadlineActive: boolean;
  setAnswerRevealed: (revealed: boolean) => void;
  timerPaused: boolean;
  setGameTimerActive: (active: boolean) => void;
  setStopGameTimerHandler: (fn: (() => void) | null) => void;
}

/** Joins the per-question examples into a single string for the gamemaster card. */
function examplesSummary(q: WerKenntMehrQuestion): string | undefined {
  if (q.answerList && q.answerList.length > 0) return q.answerList.join(', ');
  return q.answer || undefined;
}

function WerKenntMehrInner({
  questions,
  gameTitle,
  scoringMode,
  pointValue,
  onGameComplete,
  onAwardPoints,
  setNavHandler,
  setBackNavHandler,
  setGamemasterData,
  setGamemasterControls,
  setCommandHandler,
  setNavState,
  deadlineActive,
  setAnswerRevealed,
  timerPaused,
  setGameTimerActive,
  setStopGameTimerHandler,
}: InnerProps) {
  const { state } = useGameContext();
  const [qIdx, setQIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('question');
  const [team1Sel, setTeam1Sel] = useState(false);
  const [team2Sel, setTeam2Sel] = useState(false);
  const [count, setCount] = useState('');
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerStopped, setTimerStopped] = useState(false);
  const [timerKey, setTimerKey] = useState(0);
  // True once the host starts scoring this round (selects a team or edits the
  // count, on the frontend OR via the GM). Flips the answer-phase scroll anchor
  // from the answer to the scoring panel so the projector follows the host's
  // input. Reset on leaving the answer phase.
  const [scoringActive, setScoringActive] = useState(false);

  const q = questions[qIdx];
  // Question 0 is a non-scoring practice round (universal quiz convention):
  // its scoring panel advances without awarding points.
  const isExample = qIdx === 0;
  const questionLabel = isExample ? 'Beispiel Frage' : `Frage ${qIdx} von ${questions.length - 1}`;
  const showAnswer = phase === 'answer';

  const team1Members = state.teams.team1;
  const team2Members = state.teams.team2;
  const t1 = teamName(state.teams, 1);
  const t2 = teamName(state.teams, 2);

  // Latest values readable from the GM command handler without re-registering.
  const team1SelRef = useRef(team1Sel);
  team1SelRef.current = team1Sel;
  const team2SelRef = useRef(team2Sel);
  team2SelRef.current = team2Sel;

  // QuizQuestionView expects a SimpleQuizQuestion; our question is a structural
  // subset (it never carries audio/answer-image fields). Coerce the `answer` to
  // a string so the prop type is satisfied — `showAnswer` is always false here,
  // so QuizQuestionView never renders the answer; the examples are rendered below.
  const quizViewQuestion = useMemo<SimpleQuizQuestion>(
    () => ({ ...q, answer: q?.answer ?? '' }) as SimpleQuizQuestion,
    [q],
  );

  useEffect(() => {
    if (!q) return;
    if (phase === 'summary') {
      setGamemasterData({
        gameTitle,
        questionNumber: questions.length - 1,
        totalQuestions: questions.length - 1,
        question: 'Welches Team hat insgesamt mehr genannt?',
        answer: '',
      });
      return;
    }
    const nextQ = questions[qIdx + 1];
    // Render the examples as the same pill grid the gamemaster uses for ranking
    // (`answerList` → `.gamemaster-answer-list`, an auto-fill grid of chips).
    // When present it replaces the plain `answer` blob, so the list shows once.
    const exampleItems = q.answerList && q.answerList.length > 0
      ? q.answerList.map((text, i) => ({ rank: i + 1, text, revealed: true }))
      : undefined;
    setGamemasterData({
      gameTitle,
      questionNumber: qIdx,
      totalQuestions: questions.length - 1,
      question: q.question,
      answer: exampleItems ? '' : (q.answer ?? ''),
      answerList: exampleItems,
      nextAnswer: nextQ ? { question: nextQ.question, answer: examplesSummary(nextQ) ?? '' } : undefined,
    });
  }, [qIdx, phase, gameTitle, questions, q, setGamemasterData]);

  const isStandard = scoringMode === 'standard';
  // Penalty mode plays exactly like count mode, but the losing team also loses the
  // entered count (clamped at 0 by the reducer); a tie awards/deducts nothing.
  const isPenalty = scoringMode === 'count-penalty';

  const advanceToNext = useCallback(() => {
    if (qIdx < questions.length - 1) {
      setQIdx(prev => prev + 1);
      setPhase('question');
      setTeam1Sel(false);
      setTeam2Sel(false);
      setCount('');
      setTimerRunning(false);
      setTimerKey(k => k + 1);
    } else if (isStandard) {
      // Standard mode awards the game's points on a final reward screen.
      setPhase('summary');
    } else {
      onGameComplete();
    }
  }, [qIdx, questions.length, isStandard, onGameComplete]);

  const awardAndAdvance = useCallback((rawCount: string) => {
    if (!isExample) {
      const t1 = team1SelRef.current;
      const t2 = team2SelRef.current;
      if (!t1 && !t2) return;
      const n = parseInt(rawCount, 10) || 0;
      if (t1 && t2) {
        // Tie: count mode splits the count; penalty mode changes nothing.
        if (!isPenalty) {
          const half = Math.floor(n / 2);
          onAwardPoints('team1', half);
          onAwardPoints('team2', half);
        }
      } else if (t1) {
        onAwardPoints('team1', n);
        if (isPenalty) onAwardPoints('team2', -n);
      } else if (t2) {
        onAwardPoints('team2', n);
        if (isPenalty) onAwardPoints('team1', -n);
      }
    }
    advanceToNext();
  }, [isExample, isPenalty, onAwardPoints, advanceToNext]);

  // Standard mode: award the positional game points on the final reward screen,
  // then complete the game (BaseGameWrapper skips its own points screen).
  const finishGame = useCallback((winners: { team1: boolean; team2: boolean }) => {
    if (winners.team1) onAwardPoints('team1', pointValue);
    if (winners.team2) onAwardPoints('team2', pointValue);
    onGameComplete();
  }, [onAwardPoints, pointValue, onGameComplete]);

  // Keyboard / nav forward: question → answer (reveal). In standard mode (no
  // per-round scoring) and on the non-scoring example, nav-forward advances to the
  // next round (or the reward screen after the last). In count mode a real
  // question's answer phase does NOT advance on nav — the "Punkte vergeben" button
  // advances after the host enters the count.
  const handleNext = useCallback(() => {
    if (phase === 'question') {
      setPhase('answer');
      setTimerRunning(false);
    } else if (phase === 'answer' && (isStandard || isExample)) {
      advanceToNext();
    }
  }, [phase, isStandard, isExample, advanceToNext]);

  const handleBack = useCallback((): boolean => {
    if (phase === 'summary') {
      // Re-open the last round (its revealed answer) from the reward screen.
      setPhase('answer');
      return true;
    }
    if (phase === 'answer') {
      setPhase('question');
      return true;
    }
    if (phase === 'question' && qIdx > 0) {
      setQIdx(prev => prev - 1);
      setPhase('answer');
      return true;
    }
    return false;
  }, [phase, qIdx]);

  useEffect(() => {
    setNavHandler(handleNext);
    setBackNavHandler(handleBack);
  }, [handleNext, handleBack, setNavHandler, setBackNavHandler]);

  // Signal answer-reveal so any active GM deadline timer hides.
  useEffect(() => {
    setAnswerRevealed(showAnswer);
  }, [showAnswer, setAnswerRevealed]);

  // Gamemaster controls per phase.
  useEffect(() => {
    const controls: GamemasterControl[] = [];
    const team1Sub = team1Members.length > 0 ? team1Members.join(', ') : undefined;
    const team2Sub = team2Members.length > 0 ? team2Members.join(', ') : undefined;
    if (phase === 'answer') {
      if (isStandard) {
        // No per-round scoring in standard mode — nav-forward advances to the next
        // question (or the reward screen after the last). No scoring controls.
        setNavState({});
      } else {
        // count mode: nav-forward is a no-op on a real question (the award button
        // advances); on the example, leave it visible so → advances.
        setNavState({ hideForward: !isExample });
        controls.push({
          type: 'button-group',
          id: 'winner-selection',
          label: 'Wer hatte mehr? (beide = unentschieden)',
          buttons: [
            { id: 'toggle-team1', label: t1, sublabel: team1Sub, variant: 'primary', active: team1Sel },
            { id: 'toggle-team2', label: t2, sublabel: team2Sub, variant: 'primary', active: team2Sel },
          ],
        });
        controls.push({
          type: 'input-group',
          id: 'award-submit',
          inputs: [
            { id: `count-q${qIdx}`, label: 'Anzahl', inputType: 'number', placeholder: 'Anzahl', value: count, emitOnChange: true },
          ],
          submitLabel: isExample ? 'Weiter' : 'Punkte vergeben',
          submitDisabled: !isExample && !team1Sel && !team2Sel,
        });
      }
    } else if (phase === 'summary') {
      // Standard-mode end reward screen — host picks the overall winner.
      setNavState({ hideForward: true });
      controls.push({
        type: 'button-group',
        id: 'final-winner',
        label: 'Spielpunkte vergeben',
        buttons: [
          { id: 'final-team1', label: t1, sublabel: team1Sub, variant: 'primary' },
          { id: 'final-team2', label: t2, sublabel: team2Sub, variant: 'primary' },
          { id: 'final-draw', label: 'Unentschieden', variant: 'primary' },
        ],
      });
    } else {
      setNavState({});
    }
    setGamemasterControls(controls);
  }, [phase, qIdx, count, team1Sel, team2Sel, isExample, isStandard, team1Members, team2Members, t1, t2, setGamemasterControls, setNavState]);

  // Gamemaster command routing.
  const commandHandlerFn = useCallback((cmd: GamemasterCommand) => {
    if (cmd.controlId === 'toggle-team1') { setTeam1Sel(s => !s); setScoringActive(true); }
    else if (cmd.controlId === 'toggle-team2') { setTeam2Sel(s => !s); setScoringActive(true); }
    else if (cmd.controlId === 'final-team1') finishGame({ team1: true, team2: false });
    else if (cmd.controlId === 'final-team2') finishGame({ team1: false, team2: true });
    else if (cmd.controlId === 'final-draw') finishGame({ team1: true, team2: true });
    else if (cmd.controlId === 'award-submit:change' && cmd.value && typeof cmd.value === 'object') {
      const next = Object.values(cmd.value as Record<string, string>)[0] ?? '';
      setCount(next);
      setScoringActive(true);
    } else if (cmd.controlId === 'award-submit' && cmd.value && typeof cmd.value === 'object') {
      const next = Object.values(cmd.value as Record<string, string>)[0] ?? '';
      setCount(next);
      awardAndAdvance(next);
    }
  }, [awardAndAdvance, finishGame]);

  useEffect(() => {
    setCommandHandler(commandHandlerFn);
  }, [commandHandlerFn, setCommandHandler]);

  // Let the GM Stop button clear this game's per-question Timer.
  useEffect(() => {
    setStopGameTimerHandler(() => {
      setTimerRunning(false);
      setTimerStopped(true);
    });
    return () => setStopGameTimerHandler(null);
  }, [setStopGameTimerHandler]);

  // Reset the Stop flag on every new question so a fresh `q.timer` shows.
  useEffect(() => {
    setTimerStopped(false);
  }, [qIdx]);

  // Each answer reveal starts anchored on the answer; scoring re-anchors it to
  // the controls. Clear the flag whenever we're not showing an answer so the
  // next reveal (or a back-nav re-reveal) leads with the answer again.
  useEffect(() => {
    if (phase !== 'answer') setScoringActive(false);
  }, [phase]);

  // Start timer when entering the question phase of a timed question.
  useEffect(() => {
    if (phase === 'question' && q?.timer) setTimerRunning(true);
  }, [phase, q?.timer]);

  // Surface this game's per-question Timer to the GM toolbar (Pause/Resume).
  // A GM deadline timer overrides (hides) the per-question Timer on the show, so
  // while one is active we must NOT report the per-question timer as running —
  // otherwise the GM keeps showing it as a live timer with Pause/Stop controls
  // even though the show has stopped rendering it (the live-show bug where the
  // 120s timer "didn't start" while the GM showed it running).
  useEffect(() => {
    const active = phase === 'question' && Boolean(q?.timer) && timerRunning && !deadlineActive;
    setGameTimerActive(active);
    return () => setGameTimerActive(false);
  }, [phase, q?.timer, timerRunning, deadlineActive, setGameTimerActive]);

  // Answer-phase scroll anchor:
  //  - before scoring: anchor to the ANSWER (same target as the GM "Antwort"
  //    jump-button) so the revealed examples lead the viewport.
  //  - once the host starts scoring (`scoringActive`) in COUNT / COUNT-PENALTY
  //    mode: anchor to the BOTTOM so the on-show scoring panel stays in view —
  //    the projector follows what the host enters (team selection, count), even
  //    as the tie hint grows the card. In standard mode the panel is
  //    gamemaster-only (no on-show controls), so we stay on the answer.
  // Summary has no answer to show, so it keeps the bottom anchor.
  const followControls = scoringActive && !isStandard;
  useQuizAutoScroll(
    `${qIdx}:${phase}:${followControls}`,
    phase === 'summary' ? 'bottom' : phase === 'answer' ? (followControls ? 'bottom' : 'answer') : 'top',
  );

  if (!q) return null;

  const onScreenCanAward = isExample || team1Sel || team2Sel;

  return (
    <>
      {phase !== 'summary' && (
        <QuizQuestionView
          question={quizViewQuestion}
          questionLabel={questionLabel}
          showAnswer={false}
          timerKey={timerKey}
          timerRunning={timerRunning && !timerPaused}
          onTimerComplete={() => setTimerRunning(false)}
          timerSuppressed={showAnswer || deadlineActive || timerStopped}
          audioCurrentTime={0}
          audioDuration={0}
          audioPlaying={false}
          onAudioPlayPause={() => {}}
          onAudioRestart={() => {}}
        />
      )}

      {showAnswer && (
        <div className="quiz-answer">
          {q.answerList && q.answerList.length > 0 ? (
            <ul className="wkm-examples">
              {q.answerList.map((item, i) => (
                <li key={`${item}-${i}`}>{item}</li>
              ))}
            </ul>
          ) : (
            q.answer && <p>{q.answer}</p>
          )}
        </div>
      )}

      {/* Count mode awards per round, so its scoring panel lives on the show. In
          standard mode points are only awarded on the final reward screen, so the
          per-round controls live ONLY on the gamemaster — the show stays clean. */}
      {showAnswer && !isStandard && (
        <div className="bet-quiz-host-panel">
          <div className="bet-quiz-host-row">
            <div className="bet-quiz-team-choice">
              {team1Members.length > 0 && (
                <div className="bet-quiz-team-members">{team1Members.join(', ')}</div>
              )}
              <button
                type="button"
                className={`quiz-button${team1Sel ? ' active' : ''}`}
                onClick={() => { setTeam1Sel(s => !s); setScoringActive(true); }}
              >
                {t1}
              </button>
            </div>
            <div className="bet-quiz-team-choice">
              {team2Members.length > 0 && (
                <div className="bet-quiz-team-members">{team2Members.join(', ')}</div>
              )}
              <button
                type="button"
                className={`quiz-button${team2Sel ? ' active' : ''}`}
                onClick={() => { setTeam2Sel(s => !s); setScoringActive(true); }}
              >
                {t2}
              </button>
            </div>
          </div>
          <div className="bet-quiz-host-row">
            <input
              type="number"
              className="guess-input betting-input"
              placeholder="Anzahl"
              value={count}
              min={0}
              onFocus={() => setScoringActive(true)}
              onChange={e => setCount(e.target.value)}
            />
            <button
              type="button"
              className="quiz-button"
              disabled={!onScreenCanAward}
              onClick={() => awardAndAdvance(count)}
            >
              {isExample ? 'Weiter' : 'Punkte vergeben'}
            </button>
          </div>
          {team1Sel && team2Sel && (
            <div className="bet-quiz-host-hint">
              {isPenalty
                ? 'Unentschieden — keine Punkteänderung.'
                : 'Unentschieden — die Punkte werden geteilt.'}
            </div>
          )}
        </div>
      )}

      {phase === 'summary' && (
        <>
          {/* End-of-game point reward screen (no per-round scoring in standard mode).
              Rendered as on-card content — a plain `<h2>`, a `.bet-quiz-host-hint`
              prompt and the `.award-points-teams` buttons — NOT a nested
              `#awardPointsContainer`, whose text colour assumes the dark page bg. */}
          <h2>Punkte vergeben</h2>
          <div className="bet-quiz-host-hint">Welches Team hat insgesamt mehr genannt?</div>
          <div className="button-row award-points-teams">
            <button
              type="button"
              className="quiz-button award-team-button"
              onClick={() => finishGame({ team1: true, team2: false })}
            >
              {t1}
            </button>
            <button
              type="button"
              className="quiz-button award-team-button"
              onClick={() => finishGame({ team1: false, team2: true })}
            >
              {t2}
            </button>
            <button
              type="button"
              className="quiz-button award-team-button"
              onClick={() => finishGame({ team1: true, team2: true })}
            >
              Unentschieden
            </button>
          </div>
        </>
      )}
    </>
  );
}
