import { useState, useEffect, useCallback, type FormEvent } from 'react';
import type { GameComponentProps } from './types';
import type { GuessingGameConfig, GuessingGameQuestion } from '@/types/config';
import type { GamemasterAnswerData, GamemasterControl, GamemasterCommand } from '@/types/game';
import { formatNumber } from '@/utils/questions';
import { useShuffledQuestions } from '@/hooks/useShuffledQuestions';
import { useQuizAutoScroll } from '@/hooks/useQuizAutoScroll';
import { toMediaSrc } from '@/utils/assetUrl';
import { useGameContext } from '@/context/GameContext';
import { teamName } from '@/utils/teamNames';
import { teamDisplayOrder } from '@/utils/teamOrder';
import BaseGameWrapper from './BaseGameWrapper';
import { useFullscreen, useRegisterFullscreenMedia } from '@/context/FullscreenContext';

export default function GuessingGame(props: GameComponentProps) {
  const config = props.config as GuessingGameConfig;

  const questions = useShuffledQuestions(config.questions, config.randomizeQuestions, undefined, props.gameId);

  const totalQuestions = questions.length > 0 ? questions.length - 1 : 0;

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || ['Jedes Team gibt seinen Tipp ab.']}
      totalQuestions={totalQuestions}
      pointSystemEnabled={props.pointSystemEnabled}
      pointValue={props.currentIndex + 1}
      currentIndex={props.currentIndex}
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
      onPrevGame={props.onPrevGame}
    >
      {({ onGameComplete, setNavHandler, setGamemasterData, setGamemasterControls, setCommandHandler, setNavState, setAnswerRevealed }) => (
        <GuessingInner
          questions={questions}
          gameTitle={config.title}
          onGameComplete={onGameComplete}
          setNavHandler={setNavHandler}
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

interface GuessingInnerProps {
  questions: GuessingGameQuestion[];
  gameTitle: string;
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  setGamemasterData: (data: GamemasterAnswerData | null) => void;
  setGamemasterControls: (controls: GamemasterControl[]) => void;
  setCommandHandler: (fn: ((cmd: GamemasterCommand) => void) | null) => void;
  setNavState: (state: { hideForward?: boolean; hideBack?: boolean }) => void;
  setAnswerRevealed: (revealed: boolean) => void;
}

function GuessingInner({ questions, gameTitle, onGameComplete, setNavHandler, setGamemasterData, setGamemasterControls, setCommandHandler, setNavState, setAnswerRevealed }: GuessingInnerProps) {
  const { state } = useGameContext();
  const t1 = teamName(state.teams, 1);
  const t2 = teamName(state.teams, 2);
  const [qIdx, setQIdx] = useState(0);
  const [phase, setPhase] = useState<'question' | 'result'>('question');
  const [team1Guess, setTeam1Guess] = useState('');
  const [team2Guess, setTeam2Guess] = useState('');
  const [resultInfo, setResultInfo] = useState<{
    answer: number;
    t1Guess: number;
    t2Guess: number;
    t1Diff: number;
    t2Diff: number;
  } | null>(null);

  const q = questions[qIdx];
  const isExample = qIdx === 0;
  const questionLabel = isExample ? 'Beispiel Frage' : `Frage ${qIdx} von ${questions.length - 1}`;

  const { open: openFullscreen } = useFullscreen();
  // The answer image appears only in the result phase — expose it then.
  useRegisterFullscreenMedia(phase === 'result' && q?.answerImage ? { type: 'image', src: q.answerImage! } : null);

  useEffect(() => {
    if (!q) return;
    const nextQ = questions[qIdx + 1];
    setGamemasterData({
      gameTitle,
      questionNumber: qIdx,
      totalQuestions: questions.length - 1,
      answer: formatNumber(q.answer),
      answerImage: q.answerImage,
      nextAnswer: nextQ ? { question: nextQ.question, answer: formatNumber(nextQ.answer) } : undefined,
    });
  }, [qIdx, gameTitle, questions, setGamemasterData]);

  // GuessingGame's "answer revealed" maps to the result phase. Signal the
  // wrapper so an active deadline timer hides as soon as the answer shows.
  useEffect(() => {
    setAnswerRevealed(phase === 'result');
  }, [phase, setAnswerRevealed]);

  const doSubmit = useCallback((t1: string, t2: string) => {
    const t1Val = parseFloat(t1) || 0;
    const t2Val = parseFloat(t2) || 0;
    const answer = q!.answer;
    setResultInfo({
      answer,
      t1Guess: t1Val,
      t2Guess: t2Val,
      t1Diff: Math.abs(t1Val - answer),
      t2Diff: Math.abs(t2Val - answer),
    });
    setPhase('result');
  }, [q]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    doSubmit(team1Guess, team2Guess);
  };

  const handleNext = useCallback(() => {
    if (phase === 'result') {
      if (qIdx < questions.length - 1) {
        setQIdx(prev => prev + 1);
        setPhase('question');
        setTeam1Guess('');
        setTeam2Guess('');
        setResultInfo(null);
      } else {
        onGameComplete();
      }
    }
  }, [phase, qIdx, questions.length, onGameComplete]);

  useEffect(() => {
    setNavHandler(handleNext);
  }, [handleNext, setNavHandler]);

  // Broadcast gamemaster controls
  useEffect(() => {
    const controls: GamemasterControl[] = [];
    // Question phase: GM uses input fields + submit button; nav has no meaning.
    setNavState(phase === 'question' ? { hideForward: true, hideBack: true } : {});
    if (phase === 'question') {
      // GM control panel → mirror the frontend order (GM faces the crowd). Input
      // IDs stay team-keyed, so only display order changes.
      controls.push({
        type: 'input-group',
        id: 'guess-submit',
        inputs: teamDisplayOrder(state.teams.orderSwapped, true, state.settings.teamMirrorEnabled).map(teamKey => ({
          id: `${teamKey}Guess`,
          label: `Tipp ${teamKey === 'team1' ? t1 : t2}`,
          inputType: 'number' as const,
          placeholder: `Tipp ${teamKey === 'team1' ? t1 : t2}`,
          value: teamKey === 'team1' ? team1Guess : team2Guess,
          emitOnChange: true,
        })),
        submitLabel: 'Tipp Abgeben',
      });
    }
    if (phase === 'result') {
      controls.push({
        type: 'button',
        id: 'next-question',
        label: 'Nächste Frage',
        variant: 'primary',
      });
    }
    setGamemasterControls(controls);
  }, [phase, team1Guess, team2Guess, setGamemasterControls, setNavState, t1, t2, state.teams.orderSwapped, state.settings.teamMirrorEnabled]);

  // Handle gamemaster commands
  const commandHandlerFn = useCallback((cmd: GamemasterCommand) => {
    if (cmd.controlId === 'guess-submit:change' && cmd.value && typeof cmd.value === 'object') {
      // Live mirror: every keystroke in the GM input is reflected in the
      // frontend's input fields so spectators can see the guesses being typed.
      const vals = cmd.value as Record<string, string>;
      setTeam1Guess(vals.team1Guess ?? '');
      setTeam2Guess(vals.team2Guess ?? '');
    } else if (cmd.controlId === 'guess-submit' && cmd.value && typeof cmd.value === 'object') {
      const vals = cmd.value as Record<string, string>;
      const t1 = vals.team1Guess ?? '';
      const t2 = vals.team2Guess ?? '';
      setTeam1Guess(t1);
      setTeam2Guess(t2);
      doSubmit(t1, t2);
    } else if (cmd.controlId === 'next-question') {
      handleNext();
    }
  }, [doSubmit, handleNext]);

  useEffect(() => {
    setCommandHandler(commandHandlerFn);
  }, [commandHandlerFn, setCommandHandler]);

  useQuizAutoScroll(`${qIdx}:${phase}`);

  if (!q) return null;

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>
      <div className="quiz-question">{q.question}</div>

      {phase === 'question' && (
        <form className="guess-form" onSubmit={handleSubmit}>
          {teamDisplayOrder(state.teams.orderSwapped, false, state.settings.teamMirrorEnabled).map(teamKey => {
            const label = teamKey === 'team1' ? t1 : t2;
            const value = teamKey === 'team1' ? team1Guess : team2Guess;
            const setValue = teamKey === 'team1' ? setTeam1Guess : setTeam2Guess;
            return (
              <div className="guess-input" key={teamKey}>
                <label htmlFor={`${teamKey}Guess`}>Tipp {label}:</label>
                <input
                  type="number"
                  id={`${teamKey}Guess`}
                  value={value}
                  onChange={e => setValue(e.target.value)}
                  required
                />
              </div>
            );
          })}
          <button type="submit" className="quiz-button button-centered">
            Tipp Abgeben
          </button>
        </form>
      )}

      {phase === 'result' && resultInfo && (
        <>
          <div className="quiz-answer">
            <p>{formatNumber(resultInfo.answer)}</p>
          </div>
          {teamDisplayOrder(state.teams.orderSwapped, false, state.settings.teamMirrorEnabled).map(teamKey => {
            const label = teamKey === 'team1' ? t1 : t2;
            const guess = teamKey === 'team1' ? resultInfo.t1Guess : resultInfo.t2Guess;
            const diff = teamKey === 'team1' ? resultInfo.t1Diff : resultInfo.t2Diff;
            return (
              <div className="result-row" key={teamKey}>
                <span>{label}: {formatNumber(guess)}</span>
                <span className="difference">Differenz: {formatNumber(diff)}</span>
              </div>
            );
          })}
          {resultInfo.t1Diff < resultInfo.t2Diff && (
            <div className="winner centered">{t1} ist näher dran!</div>
          )}
          {resultInfo.t2Diff < resultInfo.t1Diff && (
            <div className="winner centered">{t2} ist näher dran!</div>
          )}
          {resultInfo.t1Diff === resultInfo.t2Diff && (
            <div className="winner centered">Gleichstand!</div>
          )}
          <button className="quiz-button button-centered" onClick={handleNext}>
            Nächste Frage
          </button>
        </>
      )}

      {q.answerImage && phase === 'result' && (
        <img
          src={toMediaSrc(q.answerImage)}
          alt=""
          className="quiz-image"
          style={{ cursor: 'pointer' }}
          onClick={() => openFullscreen({ type: 'image', src: q.answerImage! })}
        />
      )}
    </>
  );
}
