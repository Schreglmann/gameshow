import { useState, useEffect, useCallback, useMemo, type FormEvent } from 'react';
import type { GameComponentProps } from './types';
import type { GuessingGameConfig, GuessingGameQuestion } from '@/types/config';
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
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
    >
      {({ onGameComplete, setNavHandler }) => (
        <GuessingInner
          questions={questions}
          onGameComplete={onGameComplete}
          setNavHandler={setNavHandler}
        />
      )}
    </BaseGameWrapper>
  );
}

interface GuessingInnerProps {
  questions: GuessingGameQuestion[];
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
}

function GuessingInner({ questions, onGameComplete, setNavHandler }: GuessingInnerProps) {
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

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const t1 = parseFloat(team1Guess) || 0;
    const t2 = parseFloat(team2Guess) || 0;
    const answer = q.answer;
    setResultInfo({
      answer,
      t1Guess: t1,
      t2Guess: t2,
      t1Diff: Math.abs(t1 - answer),
      t2Diff: Math.abs(t2 - answer),
    });
    setPhase('result');
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
