import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { GameComponentProps } from './types';
import type { FinalQuizConfig, FinalQuizQuestion } from '@/types/config';
import type { GamemasterAnswerData, GamemasterControl, GamemasterCommand } from '@/types/game';
import { toMediaSrc } from '@/utils/assetUrl';
import { useQuestionOrder, type QuestionOrderHandle } from '@/hooks/useQuestionOrder';
import { useLiveQuestionIndex } from '@/hooks/useLiveQuestionIndex';
import { useQuizAutoScroll } from '@/hooks/useQuizAutoScroll';
import { useGameContext } from '@/context/GameContext';
import { teamName } from '@/utils/teamNames';
import { ALL_TEAM_KEYS, teamKeys, teamPoints, isTeamKey, type TeamKey } from '@/utils/teams';
import { teamDisplayOrder } from '@/utils/teamOrder';
import BaseGameWrapper from './BaseGameWrapper';
import { useFullscreen, useRegisterFullscreenMedia } from '@/context/FullscreenContext';
import TeamDot from '@/components/common/TeamDot';

export default function FinalQuiz(props: GameComponentProps) {
  const config = props.config as FinalQuizConfig;
  // Never randomized, but still routed through useQuestionOrder so a live
  // question add/remove keeps the host on the same question.
  // See specs/live-question-order.md.
  const { questions, order } = useQuestionOrder(config.questions, false, undefined, props.gameId);

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || ['Beide Teams setzen Punkte und beantworten die Frage.']}
      totalQuestions={questions.length - 1}
      pointSystemEnabled={props.pointSystemEnabled}
      currentIndex={props.currentIndex}
      requiresPoints
      skipPointsScreen
      hideCorrectTracker
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
      onPrevGame={props.onPrevGame}
    >
      {({ onGameComplete, setNavHandler, setGamemasterData, setGamemasterControls, setCommandHandler, setNavState, setAnswerRevealed }) => (
        <FinalQuizInner
          questions={questions}
          order={order}
          gameTitle={config.title}
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
  questions: FinalQuizQuestion[];
  order: QuestionOrderHandle;
  gameTitle: string;
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

function FinalQuizInner({ questions, order, gameTitle, pointSystemEnabled, onGameComplete, setNavHandler, onAwardPoints, setGamemasterData, setGamemasterControls, setCommandHandler, setNavState, setAnswerRevealed }: InnerProps) {
  const [qIdx, setQIdx, qKey] = useLiveQuestionIndex(order);
  const [phase, setPhase] = useState<'question' | 'betting' | 'answer' | 'judging'>('question');
  const { state } = useGameContext();
  // Every active team bets and is judged independently — there is no interaction
  // between teams here, so the whole game is a loop over the active keys.
  // See specs/team-count.md.
  const activeTeams = useMemo(() => teamKeys(state.settings.teamCount), [state.settings.teamCount]);
  const [bets, setBets] = useState<Partial<Record<TeamKey, string>>>({});
  const [results, setResults] = useState<Partial<Record<TeamKey, 'correct' | 'incorrect'>>>({});
  const labelOf = useCallback((team: TeamKey) => teamName(state.teams, team), [state.teams]);
  // Serialized so the controls effect can depend on the VALUES, not on a fresh
  // object each render (which would republish the GM panel every render).
  const betsKey = ALL_TEAM_KEYS.map(k => bets[k] ?? '').join('|');
  const resultsKey = ALL_TEAM_KEYS.map(k => results[k] ?? '').join('|');

  const q = questions[qIdx];
  const isExample = qIdx === 0;
  const questionLabel = isExample ? 'Beispiel' : `Frage ${qIdx} von ${questions.length - 1}`;

  const { open: openFullscreen } = useFullscreen();
  const answerShown = phase === 'answer' || phase === 'judging';
  useRegisterFullscreenMedia(answerShown && q?.answerImage ? { type: 'image', src: q.answerImage! } : null);

  useEffect(() => {
    if (!q) return;
    const nextQ = questions[qIdx + 1];
    setGamemasterData({
      gameTitle,
      questionNumber: qIdx,
      totalQuestions: questions.length - 1,
      question: q.question,
      answer: q.answer,
      answerImage: q.answerImage,
      nextAnswer: nextQ ? { question: nextQ.question, answer: nextQ.answer } : undefined,
    });
  }, [qIdx, gameTitle, questions, setGamemasterData]);

  const showAnswerFn = useCallback(() => {
    setPhase('answer');
    setTimeout(() => setPhase('judging'), 100);
  }, []);

  const handleNext = useCallback(() => {
    if (phase === 'question') {
      // Points on: teams place their bets first. Points off: no betting — reveal the answer directly.
      if (pointSystemEnabled) setPhase('betting');
      else showAnswerFn();
    } else if (phase === 'judging' || (phase === 'answer' && !pointSystemEnabled)) {
      // Points off: nav-forward advances from the revealed answer (the phase
      // flips answer→judging after a short beat, so accept either) — no judging.
      if (qIdx < questions.length - 1) {
        setQIdx(prev => prev + 1);
        setPhase('question');
        setBets({});
        setResults({});
      } else {
        onGameComplete();
      }
    }
  }, [phase, qIdx, questions.length, onGameComplete, pointSystemEnabled, showAnswerFn, setQIdx]);

  useEffect(() => {
    setNavHandler(handleNext);
  }, [handleNext, setNavHandler]);

  // FinalQuiz reveals the answer once `phase` transitions out of question/betting.
  // Signal that so the GM-triggered deadline timer hides immediately.
  useEffect(() => {
    setAnswerRevealed(phase === 'answer' || phase === 'judging');
  }, [phase, setAnswerRevealed]);

  // What each team's last judgment ACTUALLY moved the score by.
  //
  // `onAwardPoints` floors the total at 0, so a team on 3 points betting 10 and
  // answering wrong only loses 3. Re-judging used to reverse the RAW bet (+10),
  // handing the team 7 points it never lost and inflating the final score. Track
  // the applied delta and reverse exactly that.
  const appliedRef = useRef<Partial<Record<TeamKey, number>>>({});

  const judgeTeam = useCallback((team: TeamKey, correct: boolean) => {
    // Defensive: with points off there is no scoring — never touch onAwardPoints.
    if (!pointSystemEnabled) return;
    const bet = parseInt(bets[team] ?? '', 10) || 0;
    const prevResult = results[team] ?? null;

    if (!isExample) {
      let points = teamPoints(state.teams, team);
      // Reverse previous judgment if changing answer — by the delta that landed,
      // not by the bet that was requested.
      if (prevResult !== null) {
        const reversal = -(appliedRef.current[team] ?? 0);
        onAwardPoints(team, reversal);
        points = Math.max(0, points + reversal);
      }
      // Apply new judgment, recording what the floor will actually allow.
      const desired = correct ? bet : -bet;
      appliedRef.current[team] = Math.max(0, points + desired) - points;
      onAwardPoints(team, desired);
    }

    setResults(prev => ({ ...prev, [team]: correct ? 'correct' : 'incorrect' }));
  }, [bets, results, isExample, onAwardPoints, pointSystemEnabled, state.teams]);

  // Broadcast gamemaster controls
  useEffect(() => {
    const controls: GamemasterControl[] = [];
    // Betting: GM uses the input + submit button. handleNext does nothing here.
    // Judging before both teams are judged: handleNext would advance and bypass
    // the disabled-button gate — hide nav until both judgments are in.
    const allJudged = activeTeams.every((t: TeamKey) => results[t] !== undefined);
    // Points off: no betting/judging gate — leave nav-forward visible so "Weiter" advances.
    if (pointSystemEnabled && (phase === 'betting' || (phase === 'judging' && !allJudged))) {
      setNavState({ hideForward: true, hideBack: true });
    } else {
      setNavState({});
    }
    // GM control panel → mirror the frontend order (GM faces the crowd). Input/
    // button IDs stay team-keyed, so only display order changes.
    const gmTeamOrder = teamDisplayOrder(
      state.teams.orderSwapped,
      true,
      state.settings.teamMirrorEnabled,
      state.settings.teamCount,
    );
    if (pointSystemEnabled && phase === 'betting') {
      controls.push({
        type: 'input-group',
        id: 'betting-submit',
        inputs: gmTeamOrder.map(teamKey => ({
          id: `${teamKey}Bet`,
          label: labelOf(teamKey),
          inputType: 'number' as const,
          placeholder: `Punkte ${labelOf(teamKey)}`,
          value: bets[teamKey] ?? '',
          emitOnChange: true,
        })),
        submitLabel: 'Antwort anzeigen',
      });
    }
    if (pointSystemEnabled && phase === 'judging') {
      gmTeamOrder.forEach(teamKey => {
        controls.push({
          type: 'button-group',
          id: `${teamKey}-judgment`,
          label: labelOf(teamKey),
          buttons: [
            { id: `${teamKey}-correct`, label: 'Richtig', variant: 'success', active: results[teamKey] === 'correct' },
            { id: `${teamKey}-incorrect`, label: 'Falsch', variant: 'danger', active: results[teamKey] === 'incorrect' },
          ],
        });
      });
      controls.push({
        type: 'button',
        id: 'next-question',
        label: qIdx < questions.length - 1 ? 'Nächste Frage' : 'Weiter',
        variant: 'primary',
        disabled: !allJudged,
      });
    }
    setGamemasterControls(controls);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, pointSystemEnabled, betsKey, resultsKey, qIdx, questions.length, setGamemasterControls, setNavState, labelOf, activeTeams, state.teams.orderSwapped, state.settings.teamMirrorEnabled, state.settings.teamCount]);

  /** Mirror the GM's bet inputs (`<teamKey>Bet`) into local state. */
  const applyBets = useCallback((vals: Record<string, string>) => {
    setBets(prev => {
      const next = { ...prev };
      for (const team of ALL_TEAM_KEYS) {
        const value = vals[`${team}Bet`];
        if (value !== undefined) next[team] = value;
      }
      return next;
    });
  }, []);

  // Handle gamemaster commands
  const commandHandlerFn = useCallback((cmd: GamemasterCommand) => {
    if (cmd.controlId === 'betting-submit:change' && cmd.value && typeof cmd.value === 'object') {
      // Live mirror: every keystroke in the GM input is reflected in the
      // frontend's input fields so spectators can see the bets being typed.
      applyBets(cmd.value as Record<string, string>);
    } else if (cmd.controlId === 'betting-submit' && cmd.value && typeof cmd.value === 'object') {
      applyBets(cmd.value as Record<string, string>);
      // Use setTimeout to let state update before showing answer
      setTimeout(() => showAnswerFn(), 0);
    } else if (cmd.controlId.endsWith('-correct') || cmd.controlId.endsWith('-incorrect')) {
      // `<teamKey>-correct` / `<teamKey>-incorrect`, one pair per active team.
      const correct = cmd.controlId.endsWith('-correct');
      const team = cmd.controlId.slice(0, cmd.controlId.lastIndexOf('-'));
      if (isTeamKey(team)) judgeTeam(team, correct);
    } else if (cmd.controlId === 'next-question') handleNext();
  }, [applyBets, showAnswerFn, judgeTeam, handleNext]);

  useEffect(() => {
    setCommandHandler(commandHandlerFn);
  }, [commandHandlerFn, setCommandHandler]);

  // Scroll the card just below the sticky header when it overflows — same
  // behaviour as SimpleQuiz. During judging the scoring buttons are the
  // actionable content at the bottom, so anchor the bottom into view instead.
  useQuizAutoScroll(`${qKey}:${phase}`, phase === 'judging' ? 'bottom' : 'top');

  if (!q) return null;

  // Crowd-facing surface → the frontend team order.
  const showOrder = teamDisplayOrder(
    state.teams.orderSwapped,
    false,
    state.settings.teamMirrorEnabled,
    state.settings.teamCount,
  );

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>
      <div className="quiz-question">{q.question}</div>

      {phase === 'betting' && pointSystemEnabled && (
        <div id="bettingForm" data-team-count={showOrder.length}>
          {showOrder.map(teamKey => (
            <input
              key={teamKey}
              type="number"
              placeholder={`Punkte ${labelOf(teamKey)}`}
              className="guess-input betting-input"
              data-team={teamKey}
              value={bets[teamKey] ?? ''}
              onChange={e => setBets(prev => ({ ...prev, [teamKey]: e.target.value }))}
            />
          ))}
          <button className="quiz-button button-centered" onClick={showAnswerFn}>
            Antwort anzeigen
          </button>
        </div>
      )}

      {(phase === 'answer' || phase === 'judging') && (
        <>
          <div className="quiz-answer">
            <p>{q.answer}</p>
          </div>
          {q.answerImage && (
            <img
              src={toMediaSrc(q.answerImage)}
              alt=""
              className="quiz-image"
              style={{ cursor: 'pointer' }}
              onClick={() => openFullscreen({ type: 'image', src: q.answerImage! })}
            />
          )}
        </>
      )}

      {/* Points off: no judging and no "Nächste Frage" button — nav-forward
          (keyboard / gamemaster) advances to the next question. */}
      {phase === 'judging' && pointSystemEnabled && (
        <div id="correctButtons" data-team-count={showOrder.length}>
          {showOrder.map(teamKey => {
            const label = labelOf(teamKey);
            const result = results[teamKey] ?? null;
            return (
              <div className="judgment-group" key={teamKey}>
                <h3><TeamDot team={teamKey} />{label}:</h3>
                <button
                  className={`quiz-button${result === 'correct' ? ' active' : ''}`}
                  onClick={() => judgeTeam(teamKey, true)}
                >
                  Richtig
                </button>
                <button
                  className={`quiz-button${result === 'incorrect' ? ' active' : ''}`}
                  onClick={() => judgeTeam(teamKey, false)}
                >
                  Falsch
                </button>
              </div>
            );
          })}
          <button
            className="quiz-button button-centered"
            style={{ marginTop: 'clamp(12px, 2.5vw, 20px)' }}
            onClick={handleNext}
            disabled={!activeTeams.every(t => results[t] !== undefined)}
          >
            {qIdx < questions.length - 1 ? 'Nächste Frage' : 'Weiter'}
          </button>
        </div>
      )}

    </>
  );
}
