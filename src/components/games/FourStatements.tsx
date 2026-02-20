import { useState, useEffect, useCallback, useMemo } from 'react';
import type { GameComponentProps } from './types';
import type { FourStatementsConfig, FourStatementsQuestion } from '@/types/config';
import { randomizeQuestions } from '@/utils/questions';
import BaseGameWrapper from './BaseGameWrapper';

interface ShuffledStatement {
  text: string;
  isWrong: boolean;
}

function shuffleStatements(q: FourStatementsQuestion): ShuffledStatement[] {
  const statements: ShuffledStatement[] = [
    ...q.trueStatements.map(s => ({ text: s, isWrong: false })),
    { text: q.wrongStatement, isWrong: true },
  ];
  return statements.sort(() => Math.random() - 0.5);
}

export default function FourStatements(props: GameComponentProps) {
  const config = props.config as FourStatementsConfig;

  const questions = useMemo(
    () => randomizeQuestions(config.questions, config.randomizeQuestions),
    [config.questions, config.randomizeQuestions]
  );

  const totalQuestions = questions.length > 0 ? questions.length - 1 : 0;

  return (
    <BaseGameWrapper
      title={config.title}
      rules={config.rules || ['Findet die falsche Aussage.']}
      totalQuestions={totalQuestions}
      pointSystemEnabled={props.pointSystemEnabled}
      onAwardPoints={props.onAwardPoints}
      onNextGame={props.onNextGame}
    >
      {({ onGameComplete, setNavHandler, setBackNavHandler }) => (
        <StatementsInner
          questions={questions}
          onGameComplete={onGameComplete}
          setNavHandler={setNavHandler}
          setBackNavHandler={setBackNavHandler}
        />
      )}
    </BaseGameWrapper>
  );
}

interface InnerProps {
  questions: FourStatementsQuestion[];
  onGameComplete: () => void;
  setNavHandler: (fn: (() => void) | null) => void;
  setBackNavHandler: (fn: (() => void) | null) => void;
}

function StatementsInner({ questions, onGameComplete, setNavHandler, setBackNavHandler }: InnerProps) {
  const [qIdx, setQIdx] = useState(0);
  const [revealedCount, setRevealedCount] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);

  const q = questions[qIdx];
  const isExample = qIdx === 0;
  const questionLabel = isExample ? 'Beispiel' : `Frage ${qIdx} von ${questions.length - 1}`;

  // Shuffle statements once per question
  const shuffled = useMemo(() => {
    return shuffleStatements(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIdx]);

  const handleNext = useCallback(() => {
    if (revealedCount < shuffled.length) {
      // Progressively reveal statements
      setRevealedCount(prev => prev + 1);
    } else if (!showAnswer) {
      setShowAnswer(true);
    } else {
      if (qIdx < questions.length - 1) {
        setQIdx(prev => prev + 1);
        setRevealedCount(0);
        setShowAnswer(false);
      } else {
        onGameComplete();
      }
    }
  }, [revealedCount, shuffled.length, showAnswer, qIdx, questions.length, onGameComplete]);

  const handleBack = useCallback(() => {
    if (showAnswer) {
      setShowAnswer(false);
    } else if (revealedCount > 0) {
      setRevealedCount(prev => prev - 1);
    }
  }, [showAnswer, revealedCount]);

  useEffect(() => {
    setNavHandler(handleNext);
    setBackNavHandler(handleBack);
  }, [handleNext, handleBack, setNavHandler, setBackNavHandler]);

  if (!q) return null;

  return (
    <>
      <h2 className="quiz-question-number">{questionLabel}</h2>
      <div className="quiz-question">{q.Frage}</div>

      <div style={{ width: '100%', maxWidth: 900, margin: '0 auto' }}>
        {shuffled.slice(0, revealedCount).map((stmt, i) => {
          let style: React.CSSProperties = {};
          if (showAnswer) {
            style = stmt.isWrong
              ? { background: 'rgba(255, 59, 48, 0.3)', borderColor: 'rgba(255, 59, 48, 0.6)' }
              : { background: 'rgba(74, 222, 128, 0.3)', borderColor: 'rgba(74, 222, 128, 0.6)' };
          }
          return (
            <div key={i} className="statement" style={style}>
              {stmt.text}
            </div>
          );
        })}
      </div>
    </>
  );
}
