import { useState, useEffect, useCallback, useMemo } from 'react';
import type { GameComponentProps } from './types';
import type { FactOrFakeConfig, FactOrFakeQuestion } from '@/types/config';
import { randomizeQuestions } from '@/utils/questions';
import BaseGameWrapper from './BaseGameWrapper';

export default function FactOrFake(props: GameComponentProps) {
  const config = props.config as FactOrFakeConfig;

  const questions = useMemo(
    () => randomizeQuestions(config.questions, config.randomizeQuestions),
    [config.questions, config.randomizeQuestions]
  );

  const totalQuestions = questions.length > 0 ? questions.length - 1 : 0;

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || ['Ist es FAKT oder FAKE?']}
      totalQuestions={totalQuestions}
      pointSystemEnabled={props.pointSystemEnabled}
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
    >
      {({ onGameComplete, setNavHandler }) => (
        <FactOrFakeInner
          questions={questions}
          onGameComplete={onGameComplete}
          setNavHandler={setNavHandler}
        />
      )}
    </BaseGameWrapper>
  );
}

interface InnerProps {
  questions: FactOrFakeQuestion[];
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
}

function FactOrFakeInner({ questions, onGameComplete, setNavHandler }: InnerProps) {
  const [qIdx, setQIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);

  const q = questions[qIdx];
  const isExample = qIdx === 0;
  const questionLabel = isExample ? 'Beispiel' : `Frage ${qIdx} von ${questions.length - 1}`;

  const handleNext = useCallback(() => {
    if (!showAnswer) {
      setShowAnswer(true);
    } else {
      if (qIdx < questions.length - 1) {
        setQIdx(prev => prev + 1);
        setShowAnswer(false);
      } else {
        onGameComplete();
      }
    }
  }, [showAnswer, qIdx, questions.length, onGameComplete]);

  useEffect(() => {
    setNavHandler(handleNext);
  }, [handleNext, setNavHandler]);

  if (!q) return null;

  const isFakt = q.answer === 'FAKT';

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>

      <div className="quiz-question">{q.statement}</div>

      {showAnswer && (
        <div className="quiz-answer">
          <p
            style={{
              fontWeight: 700,
              fontSize: '1.5em',
              color: isFakt ? '#4ade80' : '#ff3b30',
            }}
          >
            {q.answer}
          </p>
          {q.description && (
            <p style={{ marginTop: 15, fontSize: '0.9em', opacity: 0.85 }}>{q.description}</p>
          )}
        </div>
      )}
    </>
  );
}
