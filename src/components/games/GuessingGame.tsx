import { useState, useEffect, useCallback, useMemo, type FormEvent } from 'react';
import type { GameComponentProps } from './types';
import type { GuessingGameConfig, GuessingGameQuestion } from '@/types/config';
import type { GamemasterAnswerData, GamemasterControl, GamemasterCommand } from '@/types/game';
import { randomizeQuestions, formatNumber } from '@/utils/questions';
import BaseGameWrapper from './BaseGameWrapper';

export default function GuessingGame(props: GameComponentProps) {
  const config = props.config as GuessingGameConfig;

  const questions = useMemo(
    () => randomizeQuestions(config.questions, config.randomizeQuestions),
    [config.questions, config.randomizeQuestions]
  );

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
    >
      {({ onGameComplete, setNavHandler, setGamemasterData, setGamemasterControls, setCommandHandler }) => (
        <GuessingInner
          questions={questions}
          gameTitle={config.title}
          onGameComplete={onGameComplete}
          setNavHandler={setNavHandler}
          setGamemasterData={setGamemasterData}
          setGamemasterControls={setGamemasterControls}
          setCommandHandler={setCommandHandler}
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
}

function GuessingInner({ questions, gameTitle, onGameComplete, setNavHandler, setGamemasterData, setGamemasterControls, setCommandHandler }: GuessingInnerProps) {
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

  useEffect(() => {
    if (!q) return;
    setGamemasterData({
      gameTitle,
      questionNumber: qIdx,
      totalQuestions: questions.length - 1,
      answer: formatNumber(q.answer),
      answerImage: q.answerImage,
    });
  }, [qIdx, gameTitle, questions, setGamemasterData]);

  const doSubmit = useCallback((t1: string, t2: string) => {
    const t1Val = parseFloat(t1) || 0;
    const t2Val = parseFloat(t2) || 0;
    const answer = q.answer;
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
    if (phase === 'question') {
      controls.push({
        type: 'input-group',
        id: 'guess-submit',
        inputs: [
          { id: 'team1Guess', label: 'Tipp Team 1', inputType: 'number', placeholder: 'Tipp Team 1', value: team1Guess },
          { id: 'team2Guess', label: 'Tipp Team 2', inputType: 'number', placeholder: 'Tipp Team 2', value: team2Guess },
        ],
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
  }, [phase, team1Guess, team2Guess, setGamemasterControls]);

  // Handle gamemaster commands
  const commandHandlerFn = useCallback((cmd: GamemasterCommand) => {
    if (cmd.controlId === 'guess-submit' && cmd.value && typeof cmd.value === 'object') {
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

  if (!q) return null;

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>
      <div className="quiz-question">{q.question}</div>

      {phase === 'question' && (
        <form className="guess-form" onSubmit={handleSubmit}>
          <div className="guess-input">
            <label htmlFor="team1Guess">Tipp Team 1:</label>
            <input
              type="number"
              id="team1Guess"
              value={team1Guess}
              onChange={e => setTeam1Guess(e.target.value)}
              required
            />
          </div>
          <div className="guess-input">
            <label htmlFor="team2Guess">Tipp Team 2:</label>
            <input
              type="number"
              id="team2Guess"
              value={team2Guess}
              onChange={e => setTeam2Guess(e.target.value)}
              required
            />
          </div>
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
          <div className="result-row">
            <span>Team 1: {formatNumber(resultInfo.t1Guess)}</span>
            <span className="difference">Differenz: {formatNumber(resultInfo.t1Diff)}</span>
          </div>
          <div className="result-row">
            <span>Team 2: {formatNumber(resultInfo.t2Guess)}</span>
            <span className="difference">Differenz: {formatNumber(resultInfo.t2Diff)}</span>
          </div>
          {resultInfo.t1Diff < resultInfo.t2Diff && (
            <div className="winner centered">Team 1 ist näher dran!</div>
          )}
          {resultInfo.t2Diff < resultInfo.t1Diff && (
            <div className="winner centered">Team 2 ist näher dran!</div>
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
        <img src={q.answerImage} alt="" className="quiz-image" />
      )}
    </>
  );
}
