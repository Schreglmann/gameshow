import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { GameComponentProps } from './types';
import type { WerKenntMehrConfig, WerKenntMehrQuestion, SimpleQuizQuestion } from '@/types/config';
import type { GamemasterAnswerData, GamemasterControl, GamemasterCommand } from '@/types/game';
import { useGameContext } from '@/context/GameContext';
import { teamName } from '@/utils/teamNames';
import { ALL_TEAM_KEYS, teamKeys, isTeamKey, type TeamKey } from '@/utils/teams';
import { teamDisplayOrder } from '@/utils/teamOrder';
import { useQuestionOrder, type QuestionOrderHandle } from '@/hooks/useQuestionOrder';
import { useLiveQuestionIndex } from '@/hooks/useLiveQuestionIndex';
import { EXAMPLE_SLOT_ID } from '@/utils/questionOrder';
import { gamePointValue } from '@/utils/pointMode';
import { useQuizAutoScroll } from '@/hooks/useQuizAutoScroll';
import BaseGameWrapper from './BaseGameWrapper';
import QuizQuestionView from './QuizQuestionView';
import AwardPoints, { selectedTeams, type AwardPointsWinners } from '@/components/common/AwardPoints';

/** Nothing picked yet on the summary reward screen. Module-level for a stable identity. */
const NO_WINNERS: AwardPointsWinners = {};

export default function WerKenntMehr(props: GameComponentProps) {
  const config = props.config as WerKenntMehrConfig;
  const { questions, order } = useQuestionOrder(config.questions, config.randomizeQuestions, config.questionLimit, props.gameId);
  const totalQuestions = questions.length > 0 ? questions.length - 1 : 0;
  const scoringMode = config.scoringMode ?? 'standard';
  // Standard mode awards the game's points on its own summary screen, so it has to
  // follow the gameshow's point mode itself. `per-correct-answer` never applies here:
  // the game hides the correct-answer tracker, so there is no tally to pay out — it
  // falls back to the positional value (see specs/point-system.md).
  const { state } = useGameContext();
  const pointValue = gamePointValue(state.settings.pointMode, props.currentIndex);

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || [
        'Beide Teams nennen nacheinander so viele passende Begriffe wie möglich.',
        'Das Team mit den meisten richtigen Nennungen gewinnt die Runde.',
        // 'standard' (default) scores like every other game (whatever the gameshow's
        // point mode says), so it carries no count-based scoring line — 'count' /
        // 'count-penalty' do, because they define their own point values.
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
      currentIndex={props.currentIndex}
      requiresPoints
      skipPointsScreen
      hideCorrectTracker
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
      onPrevGame={props.onPrevGame}
      resumeAtEnd={props.resumeAtEnd}
      order={order}
    >
      {({ onGameComplete, resumeAtEnd, setNavHandler, setBackNavHandler, setGamemasterData, setGamemasterControls, setCommandHandler, setNavState, setAnswerRevealed, setGameTimer }) => (
        <WerKenntMehrInner
          questions={questions}
          order={order}
          resumeAtEnd={resumeAtEnd}
          gameTitle={config.title}
          scoringMode={scoringMode}
          pointSystemEnabled={props.pointSystemEnabled}
          pointValue={pointValue}
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
  order: QuestionOrderHandle;
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
  /** The game's points under the gameshow's point mode, awarded to the winner in
   *  standard mode. Resolved by the outer component via `gamePointValue`. */
  pointValue: number;
  onGameComplete: () => void;
  onAwardPoints: (team: TeamKey, points: number) => void;
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
  order,
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
  const [qIdx, setQIdx, qKey] = useLiveQuestionIndex(order, resumeAtEnd);
  const [phase, setPhase] = useState<Phase>(resumeAtEnd ? 'answer' : 'question');
  // Which teams the host has marked as having named more this round. A set, not
  // a pair — count mode splits a tie across however many are selected, and
  // standard mode records one winner per round. See specs/team-count.md.
  const [selected, setSelected] = useState<Partial<Record<TeamKey, boolean>>>({});
  const selectedKey = ALL_TEAM_KEYS.map(k => (selected[k] ? '1' : '0')).join('');
  const [count, setCount] = useState('');
  // True once the host starts scoring this round (selects a team or edits the
  // count, on the frontend OR via the GM). Flips the answer-phase scroll anchor
  // from the answer to the scoring panel so the projector follows the host's
  // input. Reset on leaving the answer phase.
  const [scoringActive, setScoringActive] = useState(false);
  // Standard mode only: per-round round-win record the host keeps on the GM
  // ("wer hatte mehr?"). One entry per round holding the SET of teams that won it —
  // several selected teams is a shared round (a draw between them), the same
  // "multiple = unentschieden" convention the award screens use, so there is no
  // separate Unentschieden button. Keyed by the question's stable SLOT — not its
  // index, which a live question add/remove shifts and would silently reassign every
  // recorded round to a different question. Back-navigation still reveals the
  // recorded selection; the example round (slot 0) is never counted. Purely a
  // scorekeeping aid — the host still confirms the overall winner on the summary.
  const [roundWins, setRoundWins] = useState<Record<number, Partial<Record<TeamKey, boolean>>>>({});

  const q = questions[qIdx];
  // Question 0 is a non-scoring practice round (universal quiz convention):
  // its scoring panel advances without awarding points.
  const isExample = qIdx === 0;
  const questionLabel = isExample ? 'Beispiel Frage' : `Frage ${qIdx} von ${questions.length - 1}`;
  const showAnswer = phase === 'answer';
  // Examples are optional for this type — a question may carry none at all.
  const hasExamples = Boolean(q?.answerList?.length) || Boolean(q?.answer);

  const activeTeams = useMemo(() => teamKeys(state.settings.teamCount), [state.settings.teamCount]);
  const labelOf = useCallback((team: TeamKey) => teamName(state.teams, team), [state.teams]);

  // Latest values readable from the GM command handler without re-registering.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

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
    const wins: Partial<Record<TeamKey, number>> = {};
    for (const team of ALL_TEAM_KEYS) wins[team] = 0;
    for (const [slot, winners] of Object.entries(roundWins)) {
      if (Number(slot) === EXAMPLE_SLOT_ID) continue;
      // A round shared by several teams counts as a win for each of them.
      for (const team of ALL_TEAM_KEYS) {
        if (winners[team] === true) wins[team] = (wins[team] ?? 0) + 1;
      }
    }
    const scored = ALL_TEAM_KEYS.reduce((sum, k) => sum + (wins[k] ?? 0), 0);
    return { wins, scored };
  }, [roundWins]);
  const tallyText = `Rundenstand — ${activeTeams.map(k => `${labelOf(k)}: ${roundTally.wins[k] ?? 0}`).join(' · ')}`;

  const advanceToNext = useCallback(() => {
    if (qIdx < questions.length - 1) {
      setQIdx(prev => prev + 1);
      setPhase('question');
      setSelected({});
      setCount('');
    } else if (isStandard && pointSystemEnabled) {
      // Standard mode awards the game's points on a final reward screen. With the
      // point system off there is nothing to award — skip the winner screen and
      // just complete the game.
      setPhase('summary');
    } else {
      onGameComplete();
    }
  }, [qIdx, questions.length, isStandard, pointSystemEnabled, onGameComplete, setQIdx]);

  const awardAndAdvance = useCallback((rawCount: string) => {
    if (pointSystemEnabled && !isExample) {
      const winners = activeTeams.filter(t => selectedRef.current[t] === true);
      if (winners.length === 0) return;
      const n = parseInt(rawCount, 10) || 0;
      if (winners.length > 1) {
        // Tie: count mode splits the count between everyone who tied; penalty
        // mode changes nothing (it is 2-teams-only, so a tie there is both teams).
        if (!isPenalty) {
          const share = Math.floor(n / winners.length);
          for (const team of winners) onAwardPoints(team, share);
        }
      } else {
        const winner = winners[0]!;
        onAwardPoints(winner, n);
        // count-penalty is declared 2-teams-only, so "the loser" is well defined.
        if (isPenalty) {
          for (const team of activeTeams) if (team !== winner) onAwardPoints(team, -n);
        }
      }
    }
    advanceToNext();
  }, [pointSystemEnabled, isExample, isPenalty, onAwardPoints, advanceToNext, activeTeams]);

  // Aufholjoker: the armed team's positional points double on the reward screen,
  // mirroring BaseGameWrapper.handleComplete. Multiply the positional value (never a
  // hardcoded 2). The armed flag itself is cleared afterwards by
  // BaseGameWrapper.onGameComplete's inline-scored branch. Hoisted out of
  // `finishGame` so the screen previews exactly what it books.
  const armedTeam = state.teams.doubleNextGame;
  const ptsFor = useCallback(
    (team: TeamKey) => (armedTeam === team ? pointValue * 2 : pointValue),
    [armedTeam, pointValue],
  );

  // Standard mode: award the positional game points on the final reward screen,
  // then complete the game (BaseGameWrapper skips its own points screen).
  const finishGame = useCallback((winners: AwardPointsWinners) => {
    for (const team of selectedTeams(winners, activeTeams)) onAwardPoints(team, ptsFor(team));
    onGameComplete();
  }, [onAwardPoints, ptsFor, onGameComplete, activeTeams]);

  // The host's pick on the reward screen. Untouched (`null`) it follows the recorded
  // round wins, so the screen opens on the team that actually led; an equal count
  // preselects both, i.e. a draw.
  const [finalPick, setFinalPick] = useState<AwardPointsWinners | null>(null);
  // Memoised: this object feeds the gamemaster-controls effect, which would otherwise
  // re-publish the controls on every render.
  const finalPreselect = useMemo(() => {
    if (roundTally.scored === 0) return null;
    // Every team on the top round-win count; several is a draw between them.
    const best = Math.max(...activeTeams.map(t => roundTally.wins[t] ?? 0));
    const winners: AwardPointsWinners = {};
    for (const team of activeTeams) {
      if ((roundTally.wins[team] ?? 0) === best) winners[team] = true;
    }
    return winners;
  }, [roundTally, activeTeams]);
  const finalWinners = finalPick ?? finalPreselect ?? NO_WINNERS;
  const toggleFinalWinner = useCallback((team: TeamKey) => {
    // Toggling against what is currently shown, so the first press after a
    // preselection deselects that team instead of starting from an empty pick.
    setFinalPick(prev => {
      const base = prev ?? finalPreselect ?? NO_WINNERS;
      return { ...base, [team]: base[team] !== true };
    });
  }, [finalPreselect]);
  const confirmFinal = useCallback(() => {
    if (selectedTeams(finalWinners, activeTeams).length === 0) return;
    finishGame(finalWinners);
  }, [finalWinners, finishGame, activeTeams]);

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
  }, [phase, qIdx, setQIdx]);

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
    // GM control panel → mirror the frontend order (GM faces the crowd). IDs stay
    // team-keyed, so only display order changes; "Unentschieden" always stays last.
    const gmOrder = teamDisplayOrder(
      state.teams.orderSwapped,
      true,
      state.settings.teamMirrorEnabled,
      state.settings.teamCount,
    );
    const subs = {} as Record<TeamKey, string | undefined>;
    for (const key of ALL_TEAM_KEYS) {
      const members = state.teams[key] ?? [];
      subs[key] = members.length > 0 ? members.join(', ') : undefined;
    }
    const labelFor = labelOf;
    if (phase === 'answer') {
      if (isStandard) {
        // Standard mode has no count entry. With the point system on, real rounds get
        // a GM-only round-win recorder ("Wer hatte mehr?") plus a running tally so the
        // host can keep score — the show frontend stays clean. Nav-forward still
        // advances (recording is optional). The example round and a disabled point
        // system get plain nav with no scoring controls.
        setNavState({});
        if (pointSystemEnabled && !isExample) {
          const sel = roundWins[qKey] ?? {};
          controls.push({
            type: 'button-group',
            id: 'round-winner',
            label: 'Wer hatte mehr? (mehrere = unentschieden)',
            buttons: gmOrder.map(k => ({
              id: `round-${k}`,
              label: labelFor(k),
              sublabel: subs[k],
              variant: 'primary' as const,
              active: sel[k] === true,
            })),
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
          label: 'Wer hatte mehr? (mehrere = unentschieden)',
          buttons: gmOrder.map(k => ({
            id: `toggle-${k}`,
            label: labelFor(k),
            sublabel: subs[k],
            variant: 'primary' as const,
            active: selected[k] === true,
          })),
        });
        controls.push({
          type: 'input-group',
          id: 'award-submit',
          inputs: [
            { id: `count-q${qIdx}`, label: 'Anzahl', inputType: 'number', placeholder: 'Anzahl', value: count, emitOnChange: true },
          ],
          submitLabel: isExample ? 'Weiter' : 'Punkte vergeben',
          submitDisabled: !isExample && activeTeams.every(t => selected[t] !== true),
        });
      }
    } else if (phase === 'summary') {
      // Standard-mode end reward screen — host picks the overall winner.
      setNavState({ hideForward: true });
      controls.push({
        type: 'button-group',
        id: 'final-winner',
        label: 'Spielpunkte vergeben (mehrere = unentschieden)',
        buttons: gmOrder.map(k => ({
          id: `final-toggle-${k}`,
          label: labelFor(k),
          sublabel: subs[k],
          variant: 'primary' as const,
          active: finalWinners[k],
        })),
      });
      controls.push({
        type: 'button',
        id: 'final-confirm',
        label: 'Punkte vergeben & weiter',
        variant: 'primary',
        disabled: activeTeams.every(t => finalWinners[t] !== true),
      });
      // Show the accumulated round-win tally as guidance for the winner pick.
      controls.push({ type: 'info', id: 'final-tally', text: tallyText });
    } else {
      setNavState({});
    }
    setGamemasterControls(controls);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, qIdx, qKey, count, selectedKey, isExample, isStandard, pointSystemEnabled, labelOf, activeTeams, roundWins, tallyText, finalWinners, state.teams, state.settings.teamMirrorEnabled, state.settings.teamCount, setGamemasterControls, setNavState]);

  // Gamemaster command routing.
  const commandHandlerFn = useCallback((cmd: GamemasterCommand) => {
    if (cmd.controlId.startsWith('toggle-team')) {
      const team = cmd.controlId.slice('toggle-'.length);
      if (isTeamKey(team)) {
        setSelected(prev => ({ ...prev, [team]: prev[team] !== true }));
        setScoringActive(true);
      }
    }
    else if (cmd.controlId.startsWith('round-team')) {
      // Standard-mode round-win record: each team toggles independently, so several
      // teams = a shared round, and tapping an active button again clears that team
      // (mis-taps stay undoable).
      const team = cmd.controlId.slice('round-'.length);
      if (isTeamKey(team)) {
        setRoundWins(prev => {
          const round = { ...(prev[qKey] ?? {}), [team]: prev[qKey]?.[team] !== true };
          if (ALL_TEAM_KEYS.every(k => round[k] !== true)) {
            const next = { ...prev };
            delete next[qKey];
            return next;
          }
          return { ...prev, [qKey]: round };
        });
      }
    }
    // Legacy id: a gamemaster still showing the pre-toggle controls (stale push)
    // means "shared round" — record every active team rather than dropping the press.
    else if (cmd.controlId === 'round-draw') {
      const all: Partial<Record<TeamKey, boolean>> = {};
      for (const team of activeTeams) all[team] = true;
      setRoundWins(prev => ({ ...prev, [qKey]: all }));
    }
    else if (cmd.controlId.startsWith('final-toggle-')) {
      const team = cmd.controlId.slice('final-toggle-'.length);
      if (isTeamKey(team)) toggleFinalWinner(team);
    }
    else if (cmd.controlId === 'final-confirm') confirmFinal();
    // Pre-toggle ids: a gamemaster on an older cached bundle still emits these, so
    // honour them as an immediate award instead of dropping the host's press. Such
    // a bundle only knows two teams, so `final-draw` means "everyone" here.
    else if (cmd.controlId === 'final-draw') {
      const all: AwardPointsWinners = {};
      for (const team of activeTeams) all[team] = true;
      finishGame(all);
    }
    else if (cmd.controlId === 'final-team1' || cmd.controlId === 'final-team2') {
      finishGame({ [cmd.controlId === 'final-team1' ? 'team1' : 'team2']: true });
    }
    else if (cmd.controlId === 'award-submit:change' && cmd.value && typeof cmd.value === 'object') {
      const next = Object.values(cmd.value as Record<string, string>)[0] ?? '';
      setCount(next);
      setScoringActive(true);
    } else if (cmd.controlId === 'award-submit' && cmd.value && typeof cmd.value === 'object') {
      const next = Object.values(cmd.value as Record<string, string>)[0] ?? '';
      setCount(next);
      awardAndAdvance(next);
    }
  }, [awardAndAdvance, finishGame, toggleFinalWinner, confirmFinal, qKey, activeTeams]);

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
  }, [qKey, phase, q?.timer, setGameTimer]);

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
    `${qKey}:${phase}:${followControls}`,
    phase === 'summary' ? 'bottom' : phase === 'answer' ? (followControls ? 'bottom' : 'answer') : 'top',
  );

  if (!q) return null;

  // Crowd-facing surface → the frontend team order.
  const showOrder = teamDisplayOrder(
    state.teams.orderSwapped,
    false,
    state.settings.teamMirrorEnabled,
    state.settings.teamCount,
  );
  const summaryPoints: Partial<Record<TeamKey, number>> = {};
  for (const team of activeTeams) summaryPoints[team] = ptsFor(team);

  const onScreenCanAward = isExample || activeTeams.some(t => selected[t] === true);

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

      {/* Examples are optional for this type (no correct answer exists), so the box
          is omitted entirely when there are none — `.quiz-answer` carries padding, a
          tinted background and a border, and would otherwise render as an empty
          green rectangle. See specs/games/wer-kennt-mehr.md. */}
      {showAnswer && hasExamples && (
        <div className="quiz-answer">
          {q.answerList && q.answerList.length > 0 ? (
            <ul className="wkm-examples">
              {q.answerList.map((item, i) => (
                <li key={`${item}-${i}`}>{item}</li>
              ))}
            </ul>
          ) : (
            <p>{q.answer}</p>
          )}
        </div>
      )}

      {/* Count mode awards per round, so its scoring panel lives on the show. In
          standard mode points are only awarded on the final reward screen, so the
          per-round controls live ONLY on the gamemaster — the show stays clean.
          With the point system off there is no scoring at all — hide the panel. */}
      {showAnswer && !isStandard && pointSystemEnabled && (
        <div className="bet-quiz-host-panel">
          <div className="bet-quiz-host-row" data-team-count={showOrder.length}>
            {showOrder.map(teamKey => {
              const members = state.teams[teamKey] ?? [];
              const sel = selected[teamKey] === true;
              return (
                <div className="bet-quiz-team-choice" key={teamKey}>
                  {members.length > 0 && (
                    <div className="bet-quiz-team-members">{members.join(', ')}</div>
                  )}
                  <button
                    type="button"
                    className={`quiz-button${sel ? ' active' : ''}`}
                    onClick={() => {
                      setSelected(prev => ({ ...prev, [teamKey]: prev[teamKey] !== true }));
                      setScoringActive(true);
                    }}
                  >
                    {labelOf(teamKey)}
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
          {activeTeams.filter(t => selected[t] === true).length > 1 && (
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
          {/* End-of-game point reward screen (no per-round scoring in standard mode):
              the shared award screen, rendered `inline` as on-card content — NOT a
              nested `#awardPointsContainer`, whose text colour assumes the dark page
              bg. `.wkm-summary` supplies the vertical rhythm the bare elements lack. */}
          <AwardPoints
            inline
            selected={finalWinners}
            points={summaryPoints}
            hint="Welches Team hat insgesamt mehr genannt?"
            note={roundTally.scored > 0
              ? `Rundenstand: ${activeTeams.map(t => `${labelOf(t)} ${roundTally.wins[t] ?? 0}`).join(' · ')}`
              : undefined}
            onToggle={toggleFinalWinner}
            onConfirm={confirmFinal}
          />
        </div>
      )}
    </>
  );
}
