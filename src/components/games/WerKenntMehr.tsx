import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { GameComponentProps } from './types';
import type { WerKenntMehrConfig, WerKenntMehrQuestion, SimpleQuizQuestion } from '@/types/config';
import type { GamemasterAnswerData, GamemasterControl, GamemasterCommand } from '@/types/game';
import { useGameContext } from '@/context/GameContext';
import { teamName } from '@/utils/teamNames';
import { teamDisplayOrder } from '@/utils/teamOrder';
import { useShuffledQuestions } from '@/hooks/useShuffledQuestions';
import { useQuizAutoScroll } from '@/hooks/useQuizAutoScroll';
import BaseGameWrapper from './BaseGameWrapper';
import QuizQuestionView from './QuizQuestionView';

export default function WerKenntMehr(props: GameComponentProps) {
  const config = props.config as WerKenntMehrConfig;
  const questions = useShuffledQuestions(config.questions, config.randomizeQuestions, config.questionLimit, props.gameId);
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
      onPrevGame={props.onPrevGame}
      resumeAtEnd={props.resumeAtEnd}
    >
      {({ onGameComplete, resumeAtEnd, setNavHandler, setBackNavHandler, setGamemasterData, setGamemasterControls, setCommandHandler, setNavState, setAnswerRevealed, setGameTimer }) => (
        <WerKenntMehrInner
          questions={questions}
          resumeAtEnd={resumeAtEnd}
          gameTitle={config.title}
          scoringMode={scoringMode}
          pointSystemEnabled={props.pointSystemEnabled}
          pointValue={props.currentIndex + 1}
          onGameComplete={onGameComplete}
          onAwardPoints={props.onAwardPoints}
          setNavHandler={setNavHandler}
          setBackNavHandler={setBackNavHandler}
          setGamemasterData={setGamemasterData}
          setGamemasterControls={setGamemasterControls}
          setCommandHandler={setCommandHandler}
          setNavState={setNavState}
          setAnswerRevealed={setAnswerRevealed}
          setGameTimer={setGameTimer}
        />
      )}
    </BaseGameWrapper>
  );
}

type Phase = 'question' | 'answer' | 'summary';

interface InnerProps {
  questions: WerKenntMehrQuestion[];
  resumeAtEnd: boolean;
  gameTitle: string;
  /** 'standard' (default): tally round wins and award the positional game points to
   *  the leader on a final confirm screen. 'count': award the entered item count
   *  inline. 'count-penalty': like 'count', but the losing team also loses the
   *  entered count (clamped at 0); a tie does nothing. */
  scoringMode: 'count' | 'standard' | 'count-penalty';
  /** When false the point system is off: all scoring UI is hidden and the host
   *  advances through every round with plain nav-forward, never awarding points. */
  pointSystemEnabled: boolean;
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
  setAnswerRevealed: (revealed: boolean) => void;
  setGameTimer: (seconds: number | null) => void;
}

/** Joins the per-question examples into a single string for the gamemaster card. */
function examplesSummary(q: WerKenntMehrQuestion): string | undefined {
  if (q.answerList && q.answerList.length > 0) return q.answerList.join(', ');
  return q.answer || undefined;
}

function WerKenntMehrInner({
  questions,
  resumeAtEnd,
  gameTitle,
  scoringMode,
  pointSystemEnabled,
  pointValue,
  onGameComplete,
  onAwardPoints,
  setNavHandler,
  setBackNavHandler,
  setGamemasterData,
  setGamemasterControls,
  setCommandHandler,
  setNavState,
  setAnswerRevealed,
  setGameTimer,
}: InnerProps) {
  const { state } = useGameContext();
  // Resuming (back-navigation): open at the last question's answer phase. The
  // live per-team count of that round isn't reconstructed — the answer is shown
  // for review (see specs/game-back-review.md).
  const [qIdx, setQIdx] = useState(() => (resumeAtEnd ? Math.max(0, questions.length - 1) : 0));
  const [phase, setPhase] = useState<Phase>(resumeAtEnd ? 'answer' : 'question');
  const [team1Sel, setTeam1Sel] = useState(false);
  const [team2Sel, setTeam2Sel] = useState(false);
  const [count, setCount] = useState('');
  // True once the host starts scoring this round (selects a team or edits the
  // count, on the frontend OR via the GM). Flips the answer-phase scroll anchor
  // from the answer to the scoring panel so the projector follows the host's
  // input. Reset on leaving the answer phase.
  const [scoringActive, setScoringActive] = useState(false);
  // Standard mode only: per-round round-win record the host keeps on the GM
  // ("wer hatte mehr?"). Keyed by qIdx so back-navigation reveals the recorded
  // selection; the example round (qIdx 0) is never counted. Purely a scorekeeping
  // aid — the host still confirms the overall winner on the summary screen.
  const [roundWins, setRoundWins] = useState<Record<number, 'team1' | 'team2' | 'draw'>>({});

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

  // Standard-mode running tally of round wins (the example round is never counted).
  // Guidance only — surfaced on the GM during rounds and on the final summary.
  const roundTally = useMemo(() => {
    let t1Wins = 0;
    let t2Wins = 0;
    let draws = 0;
    for (const [idx, winner] of Object.entries(roundWins)) {
      if (Number(idx) === 0) continue;
      if (winner === 'team1') t1Wins += 1;
      else if (winner === 'team2') t2Wins += 1;
      else draws += 1;
    }
    return { t1Wins, t2Wins, draws };
  }, [roundWins]);
  const tallyText = `Rundenstand — ${t1}: ${roundTally.t1Wins} · ${t2}: ${roundTally.t2Wins}${
    roundTally.draws > 0 ? ` · Unentschieden: ${roundTally.draws}` : ''
  }`;

  const advanceToNext = useCallback(() => {
    if (qIdx < questions.length - 1) {
      setQIdx(prev => prev + 1);
      setPhase('question');
      setTeam1Sel(false);
      setTeam2Sel(false);
      setCount('');
    } else if (isStandard && pointSystemEnabled) {
      // Standard mode awards the game's points on a final reward screen. With the
      // point system off there is nothing to award — skip the winner screen and
      // just complete the game.
      setPhase('summary');
    } else {
      onGameComplete();
    }
  }, [qIdx, questions.length, isStandard, pointSystemEnabled, onGameComplete]);

  const awardAndAdvance = useCallback((rawCount: string) => {
    if (pointSystemEnabled && !isExample) {
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
  }, [pointSystemEnabled, isExample, isPenalty, onAwardPoints, advanceToNext]);

  // Standard mode: award the positional game points on the final reward screen,
  // then complete the game (BaseGameWrapper skips its own points screen).
  const finishGame = useCallback((winners: { team1: boolean; team2: boolean }) => {
    // Aufholjoker: the armed team's positional points double on this reward
    // screen, mirroring BaseGameWrapper.handleComplete. Multiply the positional
    // value (never a hardcoded 2). The armed flag itself is cleared afterwards by
    // BaseGameWrapper.onGameComplete's inline-scored branch.
    const armed = state.teams.doubleNextGame;
    const ptsFor = (team: 'team1' | 'team2') => (armed === team ? pointValue * 2 : pointValue);
    if (winners.team1) onAwardPoints('team1', ptsFor('team1'));
    if (winners.team2) onAwardPoints('team2', ptsFor('team2'));
    onGameComplete();
  }, [onAwardPoints, pointValue, onGameComplete, state.teams.doubleNextGame]);

  // Keyboard / nav forward: question → answer (reveal). In standard mode (no
  // per-round scoring) and on the non-scoring example, nav-forward advances to the
  // next round (or the reward screen after the last). In count mode a real
  // question's answer phase does NOT advance on nav — the "Punkte vergeben" button
  // advances after the host enters the count.
  const handleNext = useCallback(() => {
    if (phase === 'question') {
      setPhase('answer');
    } else if (phase === 'answer' && (isStandard || isExample || !pointSystemEnabled)) {
      // Points off: no per-round scoring in any mode — nav-forward always advances.
      advanceToNext();
    }
  }, [phase, isStandard, isExample, pointSystemEnabled, advanceToNext]);

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
    // GM control panel → mirror the frontend order (GM faces the crowd). IDs stay
    // team-keyed, so only display order changes; "Unentschieden" always stays last.
    const gmOrder = teamDisplayOrder(state.teams.orderSwapped, true, state.settings.teamMirrorEnabled);
    const subs = { team1: team1Sub, team2: team2Sub };
    const labelFor = (k: 'team1' | 'team2') => (k === 'team1' ? t1 : t2);
    if (phase === 'answer') {
      if (isStandard) {
        // Standard mode has no count entry. With the point system on, real rounds get
        // a GM-only round-win recorder ("Wer hatte mehr?") plus a running tally so the
        // host can keep score — the show frontend stays clean. Nav-forward still
        // advances (recording is optional). The example round and a disabled point
        // system get plain nav with no scoring controls.
        setNavState({});
        if (pointSystemEnabled && !isExample) {
          const sel = roundWins[qIdx];
          controls.push({
            type: 'button-group',
            id: 'round-winner',
            label: 'Wer hatte mehr?',
            buttons: [
              ...gmOrder.map(k => ({ id: `round-${k}`, label: labelFor(k), sublabel: subs[k], variant: 'primary' as const, active: sel === k })),
              { id: 'round-draw', label: 'Unentschieden', variant: 'primary', active: sel === 'draw' },
            ],
          });
          controls.push({ type: 'info', id: 'round-tally', text: tallyText });
        }
      } else if (!pointSystemEnabled) {
        // Count / count-penalty with the point system off — no scoring at all.
        setNavState({});
      } else {
        // count mode: nav-forward is a no-op on a real question (the award button
        // advances); on the example, leave it visible so → advances.
        setNavState({ hideForward: !isExample });
        controls.push({
          type: 'button-group',
          id: 'winner-selection',
          label: 'Wer hatte mehr? (beide = unentschieden)',
          buttons: gmOrder.map(k => ({
            id: `toggle-${k}`,
            label: labelFor(k),
            sublabel: subs[k],
            variant: 'primary' as const,
            active: k === 'team1' ? team1Sel : team2Sel,
          })),
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
          ...gmOrder.map(k => ({ id: `final-${k}`, label: labelFor(k), sublabel: subs[k], variant: 'primary' as const })),
          { id: 'final-draw', label: 'Unentschieden', variant: 'primary' },
        ],
      });
      // Show the accumulated round-win tally as guidance for the winner pick.
      controls.push({ type: 'info', id: 'final-tally', text: tallyText });
    } else {
      setNavState({});
    }
    setGamemasterControls(controls);
  }, [phase, qIdx, count, team1Sel, team2Sel, isExample, isStandard, pointSystemEnabled, team1Members, team2Members, t1, t2, roundWins, tallyText, state.teams.orderSwapped, state.settings.teamMirrorEnabled, setGamemasterControls, setNavState]);

  // Gamemaster command routing.
  const commandHandlerFn = useCallback((cmd: GamemasterCommand) => {
    if (cmd.controlId === 'toggle-team1') { setTeam1Sel(s => !s); setScoringActive(true); }
    else if (cmd.controlId === 'toggle-team2') { setTeam2Sel(s => !s); setScoringActive(true); }
    else if (cmd.controlId === 'round-team1' || cmd.controlId === 'round-team2' || cmd.controlId === 'round-draw') {
      // Standard-mode round-win record: set the winner for this round, or clear it
      // when the already-selected button is tapped again (so mis-taps are undoable).
      const pick = cmd.controlId === 'round-team1' ? 'team1' : cmd.controlId === 'round-team2' ? 'team2' : 'draw';
      setRoundWins(prev => {
        if (prev[qIdx] === pick) {
          const next = { ...prev };
          delete next[qIdx];
          return next;
        }
        return { ...prev, [qIdx]: pick };
      });
    }
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
  }, [awardAndAdvance, finishGame, qIdx]);

  useEffect(() => {
    setCommandHandler(commandHandlerFn);
  }, [commandHandlerFn, setCommandHandler]);

  // Each answer reveal starts anchored on the answer; scoring re-anchors it to
  // the controls. Clear the flag whenever we're not showing an answer so the
  // next reveal (or a back-nav re-reveal) leads with the answer again.
  useEffect(() => {
    if (phase !== 'answer') setScoringActive(false);
  }, [phase]);

  // Declare the per-question `q.timer` to BaseGameWrapper, which owns the
  // countdown (renders the ring on the show + broadcasts remaining to the GM).
  // Armed only during the question phase (these are often long, e.g. 120s);
  // cleared otherwise. A GM `timer-stop` clears it in the wrapper and it won't
  // re-arm until the next question.
  useEffect(() => {
    setGameTimer(phase === 'question' && q?.timer ? q.timer : null);
  }, [qIdx, phase, q?.timer, setGameTimer]);

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

  // Aufholjoker: badge the armed team's summary award button so the host sees the
  // ×2 before picking a winner — mirrors the shared AwardPoints screen (which this
  // standard-mode summary replaces because the game sets skipPointsScreen).
  const comebackBadge = (team: 'team1' | 'team2') =>
    state.teams.doubleNextGame === team
      ? <span className="award-double-badge" title="Aufholjoker: Punkte zählen doppelt">×2 Aufholjoker</span>
      : null;

  return (
    <>
      {phase !== 'summary' && (
        <QuizQuestionView
          question={quizViewQuestion}
          questionLabel={questionLabel}
          showAnswer={false}
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
          per-round controls live ONLY on the gamemaster — the show stays clean.
          With the point system off there is no scoring at all — hide the panel. */}
      {showAnswer && !isStandard && pointSystemEnabled && (
        <div className="bet-quiz-host-panel">
          <div className="bet-quiz-host-row">
            {teamDisplayOrder(state.teams.orderSwapped, false, state.settings.teamMirrorEnabled).map(teamKey => {
              const members = teamKey === 'team1' ? team1Members : team2Members;
              const sel = teamKey === 'team1' ? team1Sel : team2Sel;
              const setSel = teamKey === 'team1' ? setTeam1Sel : setTeam2Sel;
              return (
                <div className="bet-quiz-team-choice" key={teamKey}>
                  {members.length > 0 && (
                    <div className="bet-quiz-team-members">{members.join(', ')}</div>
                  )}
                  <button
                    type="button"
                    className={`quiz-button${sel ? ' active' : ''}`}
                    onClick={() => { setSel(s => !s); setScoringActive(true); }}
                  >
                    {teamKey === 'team1' ? t1 : t2}
                  </button>
                </div>
              );
            })}
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
        <div className="wkm-summary">
          {/* End-of-game point reward screen (no per-round scoring in standard mode).
              Rendered as on-card content — a plain `<h2>`, a `.bet-quiz-host-hint`
              prompt and the `.award-points-teams` buttons — NOT a nested
              `#awardPointsContainer`, whose text colour assumes the dark page bg.
              `.wkm-summary` supplies the vertical rhythm the bare elements lack. */}
          <h2>Punkte vergeben</h2>
          <div className="bet-quiz-host-hint">Welches Team hat insgesamt mehr genannt?</div>
          {roundTally.t1Wins + roundTally.t2Wins + roundTally.draws > 0 && (
            <div className="bet-quiz-host-hint wkm-tally">
              Rundenstand: {t1} {roundTally.t1Wins} – {roundTally.t2Wins} {t2}
              {roundTally.draws > 0 ? ` · ${roundTally.draws}× Unentschieden` : ''}
            </div>
          )}
          <div className="button-row award-points-teams">
            {teamDisplayOrder(state.teams.orderSwapped, false, state.settings.teamMirrorEnabled).map(teamKey => (
              <button
                key={teamKey}
                type="button"
                className="quiz-button award-team-button"
                onClick={() => finishGame({ team1: teamKey === 'team1', team2: teamKey === 'team2' })}
              >
                {teamKey === 'team1' ? t1 : t2}
                {comebackBadge(teamKey)}
              </button>
            ))}
            <button
              type="button"
              className="quiz-button award-team-button"
              onClick={() => finishGame({ team1: true, team2: true })}
            >
              Unentschieden
            </button>
          </div>
        </div>
      )}
    </>
  );
}
