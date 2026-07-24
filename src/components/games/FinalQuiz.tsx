import { useState, useEffect, useCallback, useMemo } from 'react';
import type { GameComponentProps } from './types';
import type { FinalQuizConfig, FinalQuizQuestion } from '@/types/config';
import type { GamemasterAnswerData, GamemasterControl, GamemasterCommand } from '@/types/game';
import { toMediaSrc } from '@/utils/assetUrl';
import { useQuizAutoScroll } from '@/hooks/useQuizAutoScroll';
import { useGameContext } from '@/context/GameContext';
import { teamName } from '@/utils/teamNames';
import { teamDisplayOrder } from '@/utils/teamOrder';
import BaseGameWrapper from './BaseGameWrapper';
import { useFullscreen, useRegisterFullscreenMedia } from '@/context/FullscreenContext';

export default function FinalQuiz(props: GameComponentProps) {
  const config = props.config as FinalQuizConfig;
  const questions = useMemo(
    () => [config.questions[0]!, ...config.questions.slice(1).filter(q => !q.disabled)],
    [config.questions]
  );

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || ['Beide Teams setzen Punkte und beantworten die Frage.']}
      totalQuestions={questions.length - 1}
      pointSystemEnabled={props.pointSystemEnabled}
      pointValue={props.currentIndex + 1}
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
  gameTitle: string;
  pointSystemEnabled: boolean;
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  onAwardPoints: (team: 'team1' | 'team2', points: number) => void;
  setGamemasterData: (data: GamemasterAnswerData | null) => void;
  setGamemasterControls: (controls: GamemasterControl[]) => void;
  setCommandHandler: (fn: ((cmd: GamemasterCommand) => void) | null) => void;
  setNavState: (state: { hideForward?: boolean; hideBack?: boolean }) => void;
  setAnswerRevealed: (revealed: boolean) => void;
}

function FinalQuizInner({ questions, gameTitle, pointSystemEnabled, onGameComplete, setNavHandler, onAwardPoints, setGamemasterData, setGamemasterControls, setCommandHandler, setNavState, setAnswerRevealed }: InnerProps) {
  const [qIdx, setQIdx] = useState(0);
  const [phase, setPhase] = useState<'question' | 'betting' | 'answer' | 'judging'>('question');
  const { state } = useGameContext();
  const t1 = teamName(state.teams, 1);
  const t2 = teamName(state.teams, 2);
  const [team1Bet, setTeam1Bet] = useState('');
  const [team2Bet, setTeam2Bet] = useState('');
  const [team1Result, setTeam1Result] = useState<'correct' | 'incorrect' | null>(null);
  const [team2Result, setTeam2Result] = useState<'correct' | 'incorrect' | null>(null);

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
        setTeam1Bet('');
        setTeam2Bet('');
        setTeam1Result(null);
        setTeam2Result(null);
      } else {
        onGameComplete();
      }
    }
  }, [phase, qIdx, questions.length, onGameComplete, pointSystemEnabled, showAnswerFn]);

  useEffect(() => {
    setNavHandler(handleNext);
  }, [handleNext, setNavHandler]);

  // FinalQuiz reveals the answer once `phase` transitions out of question/betting.
  // Signal that so the GM-triggered deadline timer hides immediately.
  useEffect(() => {
    setAnswerRevealed(phase === 'answer' || phase === 'judging');
  }, [phase, setAnswerRevealed]);

  const judgeTeam = useCallback((team: 'team1' | 'team2', correct: boolean) => {
    // Defensive: with points off there is no scoring — never touch onAwardPoints.
    if (!pointSystemEnabled) return;
    const bet = parseInt(team === 'team1' ? team1Bet : team2Bet, 10) || 0;
    const prevResult = team === 'team1' ? team1Result : team2Result;

    if (!isExample) {
      // Reverse previous judgment if changing answer
      if (prevResult !== null) {
        const prevPoints = prevResult === 'correct' ? -bet : bet;
        onAwardPoints(team, prevPoints);
      }
      // Apply new judgment
      onAwardPoints(team, correct ? bet : -bet);
    }

    if (team === 'team1') setTeam1Result(correct ? 'correct' : 'incorrect');
    else setTeam2Result(correct ? 'correct' : 'incorrect');
  }, [team1Bet, team2Bet, team1Result, team2Result, isExample, onAwardPoints, pointSystemEnabled]);

  // Broadcast gamemaster controls
  useEffect(() => {
    const controls: GamemasterControl[] = [];
    // Betting: GM uses the input + submit button. handleNext does nothing here.
    // Judging before both teams are judged: handleNext would advance and bypass
    // the disabled-button gate — hide nav until both judgments are in.
    const bothJudged = team1Result !== null && team2Result !== null;
    // Points off: no betting/judging gate — leave nav-forward visible so "Weiter" advances.
    if (pointSystemEnabled && (phase === 'betting' || (phase === 'judging' && !bothJudged))) {
      setNavState({ hideForward: true, hideBack: true });
    } else {
      setNavState({});
    }
    // GM control panel → mirror the frontend order (GM faces the crowd). Input/
    // button IDs stay team-keyed, so only display order changes.
    const gmTeamOrder = teamDisplayOrder(state.teams.orderSwapped, true, state.settings.teamMirrorEnabled);
    const labels = { team1: t1, team2: t2 } as const;
    const bets = { team1: team1Bet, team2: team2Bet } as const;
    const teamResults = { team1: team1Result, team2: team2Result } as const;
    if (pointSystemEnabled && phase === 'betting') {
      controls.push({
        type: 'input-group',
        id: 'betting-submit',
        inputs: gmTeamOrder.map(teamKey => ({
          id: `${teamKey}Bet`,
          label: labels[teamKey],
          inputType: 'number',
          placeholder: `Punkte ${labels[teamKey]}`,
          value: bets[teamKey],
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
          label: labels[teamKey],
          buttons: [
            { id: `${teamKey}-correct`, label: 'Richtig', variant: 'success', active: teamResults[teamKey] === 'correct' },
            { id: `${teamKey}-incorrect`, label: 'Falsch', variant: 'danger', active: teamResults[teamKey] === 'incorrect' },
          ],
        });
      });
      controls.push({
        type: 'button',
        id: 'next-question',
        label: qIdx < questions.length - 1 ? 'Nächste Frage' : 'Weiter',
        variant: 'primary',
        disabled: team1Result === null || team2Result === null,
      });
    }
    setGamemasterControls(controls);
  }, [phase, pointSystemEnabled, team1Bet, team2Bet, team1Result, team2Result, qIdx, questions.length, setGamemasterControls, setNavState, t1, t2, state.teams.orderSwapped, state.settings.teamMirrorEnabled]);

  // Handle gamemaster commands
  const commandHandlerFn = useCallback((cmd: GamemasterCommand) => {
    if (cmd.controlId === 'betting-submit:change' && cmd.value && typeof cmd.value === 'object') {
      // Live mirror: every keystroke in the GM input is reflected in the
      // frontend's input fields so spectators can see the bets being typed.
      const vals = cmd.value as Record<string, string>;
      setTeam1Bet(vals.team1Bet ?? '');
      setTeam2Bet(vals.team2Bet ?? '');
    } else if (cmd.controlId === 'betting-submit' && cmd.value && typeof cmd.value === 'object') {
      const vals = cmd.value as Record<string, string>;
      setTeam1Bet(vals.team1Bet ?? '');
      setTeam2Bet(vals.team2Bet ?? '');
      // Use setTimeout to let state update before showing answer
      setTimeout(() => showAnswerFn(), 0);
    } else if (cmd.controlId === 'team1-correct') judgeTeam('team1', true);
    else if (cmd.controlId === 'team1-incorrect') judgeTeam('team1', false);
    else if (cmd.controlId === 'team2-correct') judgeTeam('team2', true);
    else if (cmd.controlId === 'team2-incorrect') judgeTeam('team2', false);
    else if (cmd.controlId === 'next-question') handleNext();
  }, [showAnswerFn, judgeTeam, handleNext]);

  useEffect(() => {
    setCommandHandler(commandHandlerFn);
  }, [commandHandlerFn, setCommandHandler]);

  // Scroll the card just below the sticky header when it overflows — same
  // behaviour as SimpleQuiz. During judging the scoring buttons are the
  // actionable content at the bottom, so anchor the bottom into view instead.
  useQuizAutoScroll(`${qIdx}:${phase}`, phase === 'judging' ? 'bottom' : 'top');

  if (!q) return null;

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>
      <div className="quiz-question">{q.question}</div>

      {phase === 'betting' && pointSystemEnabled && (
        <div id="bettingForm">
          {teamDisplayOrder(state.teams.orderSwapped, false, state.settings.teamMirrorEnabled).map(teamKey => (
            <input
              key={teamKey}
              type="number"
              placeholder={`Punkte ${teamKey === 'team1' ? t1 : t2}`}
              className="guess-input betting-input"
              value={teamKey === 'team1' ? team1Bet : team2Bet}
              onChange={e => (teamKey === 'team1' ? setTeam1Bet : setTeam2Bet)(e.target.value)}
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
        <div id="correctButtons">
          {teamDisplayOrder(state.teams.orderSwapped, false, state.settings.teamMirrorEnabled).map(teamKey => {
            const label = teamKey === 'team1' ? t1 : t2;
            const result = teamKey === 'team1' ? team1Result : team2Result;
            return (
              <div className="judgment-group" key={teamKey}>
                <h3>{label}:</h3>
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
            disabled={team1Result === null || team2Result === null}
          >
            {qIdx < questions.length - 1 ? 'Nächste Frage' : 'Weiter'}
          </button>
        </div>
      )}

    </>
  );
}
